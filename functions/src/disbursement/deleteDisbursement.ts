import { onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { requireAllowedCaller } from "../lib/auth";
import { badRequest, notFound } from "../lib/errors";
import { Collections, db, FieldValue } from "../lib/firestore";
import {
  computeLoanFields,
  normaliseAdjustmentType,
  normaliseRepaymentType,
  tenureYearsToMonths,
} from "../lib/loan-math";
import { round2 } from "../lib/money";

export interface DeleteDisbursementRequest {
  disbursementId: string;
}

/**
 * Atomically delete a disbursement and roll back the loan aggregates.
 *
 * Steps inside a Firestore transaction:
 *   1. Read disbursements/{id}, fetch its loanId / amount / utrNumber.
 *   2. Read the parent loan + the utrIndex/{utr} entry (so the entire
 *      decision is consistent within the transaction).
 *   3. Compute the new aggregates by subtracting `amount` from the loan's
 *      disbursed total and re-running computeLoanFields.
 *   4. Delete disbursements/{id}, free the UTR claim (only if it still
 *      points at this disbursement), and apply the new aggregates to the
 *      loan doc.
 *
 * Why a transaction? Without it a stale read of disbursedAmount could let two
 * concurrent deletes both subtract the same amount, double-counting.
 */
export const deleteDisbursement = onCall<DeleteDisbursementRequest>(
  { region: "asia-south1", cors: true },
  async (req) => {
    requireAllowedCaller(req);
    const { disbursementId } = req.data ?? ({} as DeleteDisbursementRequest);
    if (!disbursementId || typeof disbursementId !== "string") {
      badRequest("disbursementId is required");
    }

    const disbRef = db.collection(Collections.Disbursements).doc(disbursementId);

    const result = await db.runTransaction(async (tx) => {
      const disbSnap = await tx.get(disbRef);
      if (!disbSnap.exists) {
        notFound(`Disbursement ${disbursementId} not found`);
      }
      const disb = disbSnap.data() ?? {};
      const loanId = (disb.loanId as string | undefined) ?? "";
      const amount = Number(disb.amount) || 0;
      const utr = ((disb.utrNumber as string | undefined) ?? "").toUpperCase().trim();

      if (!loanId) {
        badRequest("Disbursement has no loanId on file - cannot recompute aggregates");
      }

      const loanRef = db.collection(Collections.Loans).doc(loanId);
      const utrRef = utr ? db.collection(Collections.UtrIndex).doc(utr) : null;

      const [loanSnap, utrSnap] = await Promise.all([
        tx.get(loanRef),
        utrRef ? tx.get(utrRef) : Promise.resolve(null),
      ]);
      if (!loanSnap.exists) notFound(`Loan ${loanId} not found`);

      const loan = loanSnap.data() ?? {};
      const sanctionAmount = Number(loan.sanctionAmount) || 0;
      const previousDisbursed =
        Number(loan.disbursedAmount) || Number(loan.totalDisbursed) || 0;
      const newDisbursed = round2(Math.max(0, previousDisbursed - amount));

      const tenureMonths =
        Number(loan.tenureMonths) ||
        tenureYearsToMonths(loan.tenureYears) ||
        Number(loan.tenure) ||
        0;
      const repaymentType = normaliseRepaymentType(loan.repaymentType);
      const emiAdjustmentType = normaliseAdjustmentType(loan.emiAdjustmentType);
      const fixedEmi = Number(loan.fixedEmi) || undefined;

      const computed = computeLoanFields({
        sanctionAmount,
        disbursedAmount: newDisbursed,
        interestRate: Number(loan.interestRate) || 0,
        tenureMonths,
        currentTenureMonths:
          emiAdjustmentType === "RECALCULATE_EMI" ? tenureMonths : undefined,
        repaymentType,
        emiAdjustmentType,
        fixedEmi: emiAdjustmentType === "KEEP_EMI_EXTEND_TENURE" ? fixedEmi : undefined,
      });

      tx.delete(disbRef);
      // Only release the UTR if it actually still points at us. Defensive,
      // because a bad re-add elsewhere could have rewritten the index.
      if (utrRef && utrSnap?.exists && utrSnap.get("refId") === disbursementId) {
        tx.delete(utrRef);
      }
      tx.update(loanRef, {
        disbursedAmount: newDisbursed,
        totalDisbursed: newDisbursed,
        remainingAmount: computed.totalLoanOutstanding,
        totalLoanOutstanding: computed.totalLoanOutstanding,
        disbursementPercentage: computed.disbursementPercentage,
        emi: computed.emi,
        emiAmount: computed.emi,
        preEmi: computed.preEmi,
        preEmiAmount: computed.preEmi,
        monthlyPayment: computed.monthlyPayment,
        currentTenureMonths: computed.currentTenureMonths,
        repaymentType,
        emiAdjustmentType,
        isFullyDisbursed: computed.isFullyDisbursed,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        disbursementId,
        loanId,
        loanAggregates: {
          disbursedAmount: newDisbursed,
          totalLoanOutstanding: computed.totalLoanOutstanding,
          disbursementPercentage: computed.disbursementPercentage,
          emi: computed.emi,
          preEmi: computed.preEmi,
          monthlyPayment: computed.monthlyPayment,
          currentTenureMonths: computed.currentTenureMonths,
        },
      };
    });

    logger.info("deleteDisbursement", { disbursementId });
    return result;
  },
);
