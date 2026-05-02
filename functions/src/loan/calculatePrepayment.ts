import { onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { requireAllowedCaller } from "../lib/auth";
import { badRequest, notFound } from "../lib/errors";
import { Collections, db } from "../lib/firestore";
import {
  calculateEmi,
  computeLoanFields,
  solveTenureForFixedEmi,
  tenureYearsToMonths,
} from "../lib/loan-math";
import { round2 } from "../lib/money";

/**
 * "What if I prepay X?" calculator.
 *
 * Two prepayment modes:
 *   ONE_TIME      - lump-sum extra payment now. EMI stays the same; tenure
 *                   shrinks. This is how most banks treat a part-payment.
 *   INCREASE_EMI  - bump the monthly EMI by `extraAmount` from now until close.
 *                   Tenure shrinks more aggressively because every cheque is
 *                   bigger.
 *
 * Both modes return:
 *   - new effective tenure (in months)
 *   - new total interest payable
 *   - new total amount payable (principal + interest + extra)
 *   - savings vs the no-prepayment baseline (interest delta + tenure delta)
 *   - cash-flow impact (monthly EMI delta, lifetime extra committed)
 *
 * Pure read-only callable - no Firestore writes.
 */

type PrepaymentType = "ONE_TIME" | "INCREASE_EMI";

interface CalculatePrepaymentRequest {
  loanId?: string;
  extraAmount: number;
  prepaymentType?: PrepaymentType;
  /** Optional overrides for "what-if" callers that don't have a loan yet. */
  overrides?: {
    sanctionAmount?: number;
    disbursedAmount?: number;
    interestRate?: number;
    tenureMonths?: number;
    currentTenureMonths?: number;
  };
}

function normalisePrepaymentType(v: unknown): PrepaymentType {
  return v === "INCREASE_EMI" ? "INCREASE_EMI" : "ONE_TIME";
}

export const calculatePrepayment = onCall<CalculatePrepaymentRequest>(
  { region: "asia-south1", cors: true },
  async (req) => {
    requireAllowedCaller(req);

    const data = req.data ?? ({} as CalculatePrepaymentRequest);
    const extraAmount = Number(data.extraAmount);
    if (!Number.isFinite(extraAmount) || extraAmount <= 0) {
      badRequest("extraAmount must be a positive number");
    }
    const prepaymentType = normalisePrepaymentType(data.prepaymentType);

    // Resolve the loan snapshot: either by id or via inline overrides.
    let sanctionAmount = Number(data.overrides?.sanctionAmount) || 0;
    let disbursedAmount = Number(data.overrides?.disbursedAmount) || 0;
    let interestRate = Number(data.overrides?.interestRate) || 0;
    let tenureMonths = Number(data.overrides?.tenureMonths) || 0;
    let currentTenureMonths = Number(data.overrides?.currentTenureMonths) || 0;

    if (data.loanId) {
      const loanRef = db.collection(Collections.Loans).doc(data.loanId);
      const loanSnap = await loanRef.get();
      if (!loanSnap.exists) notFound(`Loan ${data.loanId} not found`);
      const loan = loanSnap.data() ?? {};

      // Reconstruct the disbursed total from the disbursements collection so
      // the answer is always grounded in real money, not stale aggregates.
      const disbursementsSnap = await db
        .collection(Collections.Disbursements)
        .where("loanId", "==", data.loanId)
        .get();
      const disbursedFromDocs = round2(
        disbursementsSnap.docs.reduce(
          (s, d) => s + (Number(d.get("amount")) || 0),
          0,
        ),
      );

      sanctionAmount = sanctionAmount || Number(loan.sanctionAmount) || 0;
      disbursedAmount =
        disbursedAmount ||
        disbursedFromDocs ||
        Number(loan.disbursedAmount) ||
        0;
      interestRate = interestRate || Number(loan.interestRate) || 0;
      tenureMonths =
        tenureMonths ||
        Number(loan.tenureMonths) ||
        tenureYearsToMonths(loan.tenureYears) ||
        Number(loan.tenure) ||
        0;
      currentTenureMonths =
        currentTenureMonths || Number(loan.currentTenureMonths) || 0;
    }

    if (disbursedAmount <= 0) {
      badRequest(
        "No disbursed amount available - prepayment math needs a positive principal",
      );
    }
    if (interestRate <= 0) {
      badRequest("Interest rate must be greater than zero");
    }
    if (tenureMonths <= 0) {
      badRequest("Tenure must be greater than zero");
    }

    const baseline = computeLoanFields({
      sanctionAmount,
      disbursedAmount,
      interestRate,
      tenureMonths,
      currentTenureMonths: currentTenureMonths || undefined,
      repaymentType: "FULL_EMI",
      emiAdjustmentType: "RECALCULATE_EMI",
    });

    const baseEmi = baseline.emi;
    const baseTenure = baseline.currentTenureMonths;
    const baseTotalInterest = baseline.totalInterest;
    const baseTotalPayable = baseline.totalPayable;

    if (extraAmount >= disbursedAmount && prepaymentType === "ONE_TIME") {
      // The extra payment clears the entire loan in one go.
      return buildResponse({
        prepaymentType,
        extraAmount,
        principal: disbursedAmount,
        interestRate,
        baseline: {
          monthlyPayment: baseEmi,
          tenureMonths: baseTenure,
          totalInterest: baseTotalInterest,
          totalPayable: baseTotalPayable,
        },
        scenario: {
          monthlyPayment: 0,
          tenureMonths: 0,
          totalInterest: 0,
          totalPayable: round2(extraAmount),
        },
      });
    }

    let scenarioMonthly: number;
    let scenarioTenure: number;
    let scenarioTotalInterest: number;
    let scenarioTotalPayable: number;

    if (prepaymentType === "ONE_TIME") {
      // Lump-sum: principal drops, EMI stays, tenure shrinks.
      const newPrincipal = round2(disbursedAmount - extraAmount);
      const solved = solveTenureForFixedEmi(newPrincipal, interestRate, baseEmi);
      // solveTenureForFixedEmi can return NaN if the fixed EMI would never
      // amortise (only possible at very high rates with a tiny EMI). In that
      // unlikely case, fall back to a fresh EMI on the original tenure.
      if (!Number.isFinite(solved) || solved <= 0) {
        const fresh = calculateEmi(newPrincipal, interestRate, baseTenure);
        scenarioMonthly = fresh.emi;
        scenarioTenure = baseTenure;
        scenarioTotalInterest = fresh.totalInterest;
        scenarioTotalPayable = round2(fresh.totalPayable + extraAmount);
      } else {
        scenarioMonthly = baseEmi;
        scenarioTenure = solved;
        const totalEmiPaid = round2(baseEmi * solved);
        scenarioTotalInterest = round2(totalEmiPaid - newPrincipal);
        scenarioTotalPayable = round2(totalEmiPaid + extraAmount);
      }
    } else {
      // Permanent EMI bump: principal stays, EMI grows, tenure shrinks.
      const newEmi = round2(baseEmi + extraAmount);
      const solved = solveTenureForFixedEmi(disbursedAmount, interestRate, newEmi);
      if (!Number.isFinite(solved) || solved <= 0) {
        // Pathological: even with the bump the EMI doesn't cover interest.
        // Should never happen for a positive bump but be defensive.
        scenarioMonthly = newEmi;
        scenarioTenure = baseTenure;
        scenarioTotalInterest = round2(newEmi * baseTenure - disbursedAmount);
        scenarioTotalPayable = round2(newEmi * baseTenure);
      } else {
        scenarioMonthly = newEmi;
        scenarioTenure = solved;
        const totalEmiPaid = round2(newEmi * solved);
        scenarioTotalInterest = round2(totalEmiPaid - disbursedAmount);
        scenarioTotalPayable = totalEmiPaid;
      }
    }

    const response = buildResponse({
      prepaymentType,
      extraAmount,
      principal: disbursedAmount,
      interestRate,
      baseline: {
        monthlyPayment: baseEmi,
        tenureMonths: baseTenure,
        totalInterest: baseTotalInterest,
        totalPayable: baseTotalPayable,
      },
      scenario: {
        monthlyPayment: scenarioMonthly,
        tenureMonths: scenarioTenure,
        totalInterest: scenarioTotalInterest,
        totalPayable: scenarioTotalPayable,
      },
    });

    logger.info("calculatePrepayment", {
      loanId: data.loanId,
      prepaymentType,
      extraAmount,
      interestSaved: response.savings.interestSaved,
      tenureSavedMonths: response.savings.tenureSavedMonths,
    });
    return response;
  },
);

function buildResponse(input: {
  prepaymentType: PrepaymentType;
  extraAmount: number;
  principal: number;
  interestRate: number;
  baseline: {
    monthlyPayment: number;
    tenureMonths: number;
    totalInterest: number;
    totalPayable: number;
  };
  scenario: {
    monthlyPayment: number;
    tenureMonths: number;
    totalInterest: number;
    totalPayable: number;
  };
}) {
  const { prepaymentType, extraAmount, principal, interestRate } = input;
  const interestSaved = round2(
    Math.max(0, input.baseline.totalInterest - input.scenario.totalInterest),
  );
  const tenureSavedMonths = Math.max(
    0,
    input.baseline.tenureMonths - input.scenario.tenureMonths,
  );
  const newTenureYears = Math.floor(input.scenario.tenureMonths / 12);
  const newTenureRemMonths = input.scenario.tenureMonths % 12;

  return {
    inputs: { prepaymentType, extraAmount, principal, interestRate },
    baseline: input.baseline,
    scenario: {
      ...input.scenario,
      newTenureYears,
      newTenureMonthsRemainder: newTenureRemMonths,
    },
    savings: {
      interestSaved,
      tenureSavedMonths,
      monthlyEmiDelta: round2(
        input.scenario.monthlyPayment - input.baseline.monthlyPayment,
      ),
      lifetimeOutflowDelta: round2(
        input.scenario.totalPayable - input.baseline.totalPayable,
      ),
    },
  };
}
