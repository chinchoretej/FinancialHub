import { onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { requireAllowedCaller } from "../lib/auth";
import { badRequest, notFound } from "../lib/errors";
import { Collections, db } from "../lib/firestore";
import {
  computeLoanFields,
  EmiAdjustmentType,
  generateAmortizationSchedule as generateSchedule,
  LoanSnapshot,
  normaliseAdjustmentType,
  normaliseRepaymentType,
  RepaymentType,
  tenureYearsToMonths,
} from "../lib/loan-math";

interface GenerateScheduleRequest {
  loanId?: string;
  /** Optional - if omitted, schedule starts from today (server time). */
  startDate?: string; // ISO yyyy-mm-dd
  /** What-if overrides; same shape as calculateLoanDetails.overrides. */
  overrides?: {
    sanctionAmount?: number;
    disbursedAmount?: number;
    interestRate?: number;
    tenureMonths?: number;
    tenureYears?: number;
    currentTenureMonths?: number;
    repaymentType?: RepaymentType;
    emiAdjustmentType?: EmiAdjustmentType;
    fixedEmi?: number;
  };
}

/**
 * Returns the full month-by-month amortization schedule for a loan plus a
 * pre-shaped `graph` array suitable for charting libs (one point per month
 * with `interest`, `principal`, `balance`).
 *
 * The schedule honours the loan's `repaymentType` and `emiAdjustmentType`:
 *
 *   - FULL_EMI: standard reducing-balance amortization on the disbursed
 *     amount with the active tenure (`currentTenureMonths`, fall-back
 *     `tenureMonths`). The last row truncates the residual balance to 0
 *     to absorb cumulative rounding drift.
 *
 *   - PRE_EMI: each row is interest-only on the disbursed amount, principal
 *     never reduces. Useful while construction is still ongoing.
 *
 * Pure read-only - never writes to Firestore.
 */
export const generateAmortizationSchedule = onCall<GenerateScheduleRequest>(
  { region: "asia-south1", cors: true },
  async (req) => {
    requireAllowedCaller(req);
    const { loanId, overrides, startDate } = req.data ?? {};
    if (!loanId && !overrides) {
      badRequest("Either loanId or overrides is required");
    }

    let snapshot: LoanSnapshot = {
      sanctionAmount: 0,
      disbursedAmount: 0,
      interestRate: 0,
      tenureMonths: 0,
    };

    if (loanId) {
      const snap = await db.collection(Collections.Loans).doc(loanId).get();
      if (!snap.exists) notFound(`Loan ${loanId} not found`);
      const data = snap.data() ?? {};
      const tenureMonths =
        Number(data.tenureMonths) ||
        tenureYearsToMonths(data.tenureYears) ||
        Number(data.tenure) ||
        0;
      snapshot = {
        sanctionAmount: Number(data.sanctionAmount) || 0,
        disbursedAmount:
          Number(data.disbursedAmount) || Number(data.totalDisbursed) || 0,
        interestRate: Number(data.interestRate) || 0,
        tenureMonths,
        currentTenureMonths: Number(data.currentTenureMonths) || undefined,
        repaymentType: normaliseRepaymentType(data.repaymentType),
        emiAdjustmentType: normaliseAdjustmentType(data.emiAdjustmentType),
        fixedEmi: Number(data.fixedEmi) || undefined,
      };
    }

    if (overrides) {
      if (overrides.sanctionAmount !== undefined) {
        snapshot.sanctionAmount = Number(overrides.sanctionAmount) || 0;
      }
      if (overrides.disbursedAmount !== undefined) {
        snapshot.disbursedAmount = Number(overrides.disbursedAmount) || 0;
      }
      if (overrides.interestRate !== undefined) {
        snapshot.interestRate = Number(overrides.interestRate) || 0;
      }
      if (overrides.tenureMonths !== undefined) {
        snapshot.tenureMonths = Number(overrides.tenureMonths) || 0;
      } else if (overrides.tenureYears !== undefined) {
        snapshot.tenureMonths = tenureYearsToMonths(overrides.tenureYears);
      }
      if (overrides.currentTenureMonths !== undefined) {
        snapshot.currentTenureMonths = Number(overrides.currentTenureMonths) || undefined;
      }
      if (overrides.repaymentType !== undefined) {
        snapshot.repaymentType = normaliseRepaymentType(overrides.repaymentType);
      }
      if (overrides.emiAdjustmentType !== undefined) {
        snapshot.emiAdjustmentType = normaliseAdjustmentType(overrides.emiAdjustmentType);
      }
      if (overrides.fixedEmi !== undefined) {
        snapshot.fixedEmi = Number(overrides.fixedEmi) || undefined;
      }
    }

    const start = parseStartDate(startDate);
    const schedule = generateSchedule(snapshot, { startDate: start });

    logger.info("generateAmortizationSchedule", {
      loanId,
      months: schedule.rows.length,
      principal: schedule.summary.principal,
    });

    return {
      input: snapshot,
      computed: computeLoanFields(snapshot),
      schedule,
    };
  },
);

function parseStartDate(iso: string | undefined): Date | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
