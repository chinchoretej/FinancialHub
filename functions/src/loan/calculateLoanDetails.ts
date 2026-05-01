import { onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { requireAllowedCaller } from "../lib/auth";
import { badRequest, notFound } from "../lib/errors";
import { Collections, db } from "../lib/firestore";
import { computeLoanFields, tenureYearsToMonths } from "../lib/loan-math";

interface CalculateLoanRequest {
  loanId?: string;
  /** Optional overrides - useful for "what-if" calculations from the client. */
  overrides?: {
    sanctionAmount?: number;
    disbursedAmount?: number;
    interestRate?: number;
    tenureYears?: number;
    tenureMonths?: number;
  };
}

/**
 * Pure read-only computation. Given a loan doc id (and optional overrides
 * for what-if scenarios) returns EMI / Pre-EMI / outstanding / pct disbursed.
 *
 * Does NOT write back to Firestore; the writing functions (addDisbursement /
 * recomputeLoanAggregates) are responsible for persisting.
 */
export const calculateLoanDetails = onCall<CalculateLoanRequest>(
  { region: "asia-south1", cors: true },
  async (req) => {
    requireAllowedCaller(req);

    const { loanId, overrides } = req.data ?? {};
    if (!loanId && !overrides) {
      badRequest("Either loanId or overrides is required");
    }

    let snapshot = {
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
        Number(data.tenure) || // legacy field name from the web app
        0;
      snapshot = {
        sanctionAmount: Number(data.sanctionAmount) || 0,
        disbursedAmount:
          Number(data.disbursedAmount) ?? Number(data.totalDisbursed) ?? 0,
        interestRate: Number(data.interestRate) || 0,
        tenureMonths,
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
    }

    const computed = computeLoanFields(snapshot);
    logger.info("calculateLoanDetails", { loanId, snapshot, computed });
    return { input: snapshot, computed };
  },
);
