import { onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { requireAllowedCaller } from "../lib/auth";
import { badRequest, conflict, notFound } from "../lib/errors";
import { Collections, db, FieldValue, Timestamp } from "../lib/firestore";
import { computeLoanFields, tenureYearsToMonths } from "../lib/loan-math";
import {
  isPositiveAmount,
  normaliseUtr,
  parseAmount,
  round2,
} from "../lib/money";

interface AddDisbursementRequest {
  loanId: string;
  amount: number | string;
  disbursementDate: string; // ISO yyyy-mm-dd
  utrNumber: string;
  stageId?: string;
  remarks?: string;
}

/**
 * Atomically:
 *   1. validates the input (positive amount, UTR present, disbursed total
 *      cannot exceed sanction)
 *   2. claims the UTR in the global utrIndex (rejects duplicates)
 *   3. writes the disbursement document
 *   4. increments loans/{loanId}.disbursedAmount and recomputes EMI / Pre-EMI
 *      / disbursementPercentage / totalLoanOutstanding on the loan doc.
 *
 * Wrapped in a Firestore transaction so partial failures roll back. Reads
 * (loan doc, utr doc) are issued before any writes per Firestore rules.
 */
export const addDisbursement = onCall<AddDisbursementRequest>(
  { region: "asia-south1", cors: true },
  async (req) => {
    const caller = requireAllowedCaller(req);
    const data = req.data ?? ({} as AddDisbursementRequest);

    // ---------- validation ----------
    const amount = parseAmount(data.amount);
    if (!isPositiveAmount(amount)) {
      badRequest("amount must be a positive number");
    }

    const utr = normaliseUtr(data.utrNumber);
    if (!utr) badRequest("utrNumber is required");
    if (utr.length < 6) badRequest("utrNumber looks too short");

    if (!data.loanId || typeof data.loanId !== "string") {
      badRequest("loanId is required");
    }

    const disbursementDate = parseDate(data.disbursementDate);
    if (!disbursementDate) {
      badRequest("disbursementDate must be a valid ISO date (yyyy-mm-dd)");
    }

    const stageId = data.stageId?.trim() || null;
    const remarks = (data.remarks ?? "").toString().slice(0, 500);

    // ---------- transaction ----------
    const loanRef = db.collection(Collections.Loans).doc(data.loanId);
    const utrRef = db.collection(Collections.UtrIndex).doc(utr);
    const stageRef = stageId
      ? db.collection(Collections.BuilderStages).doc(stageId)
      : null;
    const disbursementRef = db.collection(Collections.Disbursements).doc();

    const result = await db.runTransaction(async (tx) => {
      const [loanSnap, utrSnap, stageSnap] = await Promise.all([
        tx.get(loanRef),
        tx.get(utrRef),
        stageRef ? tx.get(stageRef) : Promise.resolve(null),
      ]);

      if (!loanSnap.exists) notFound(`Loan ${data.loanId} not found`);
      if (utrSnap.exists) {
        conflict(`UTR ${utr} has already been recorded`, {
          conflictingRefId: utrSnap.get("refId"),
          conflictingType: utrSnap.get("type"),
        });
      }
      if (stageRef && (!stageSnap || !stageSnap.exists)) {
        notFound(`Builder stage ${stageId} not found`);
      }

      const loan = loanSnap.data() ?? {};
      const sanctionAmount = Number(loan.sanctionAmount) || 0;
      const previousDisbursed =
        Number(loan.disbursedAmount) || Number(loan.totalDisbursed) || 0;
      const newDisbursed = round2(previousDisbursed + amount);

      if (sanctionAmount <= 0) {
        badRequest("Loan has no sanctionAmount on file - set it before disbursing");
      }
      if (newDisbursed > sanctionAmount + 0.01) {
        badRequest(
          `Disbursement would exceed sanction amount ` +
            `(${newDisbursed} > ${sanctionAmount})`,
          { sanctionAmount, attemptedDisbursed: newDisbursed },
        );
      }

      const tenureMonths =
        Number(loan.tenureMonths) ||
        tenureYearsToMonths(loan.tenureYears) ||
        Number(loan.tenure) ||
        0;
      const computed = computeLoanFields({
        sanctionAmount,
        disbursedAmount: newDisbursed,
        interestRate: Number(loan.interestRate) || 0,
        tenureMonths,
      });

      // 1. Claim the UTR.
      tx.create(utrRef, {
        type: "disbursement",
        refId: disbursementRef.id,
        loanId: data.loanId,
        amount,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: caller.uid,
      });

      // 2. Write the disbursement.
      tx.create(disbursementRef, {
        loanId: data.loanId,
        amount,
        disbursementDate: Timestamp.fromDate(disbursementDate),
        stageId,
        utrNumber: utr,
        remarks,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: caller.uid,
      });

      // 3. Update the loan aggregates.
      tx.update(loanRef, {
        disbursedAmount: newDisbursed,
        // mirror legacy field so the existing UI keeps working
        totalDisbursed: newDisbursed,
        remainingAmount: computed.totalLoanOutstanding,
        totalLoanOutstanding: computed.totalLoanOutstanding,
        disbursementPercentage: computed.disbursementPercentage,
        emi: computed.emi,
        emiAmount: computed.emi, // legacy mirror
        preEmi: computed.preEmi,
        preEmiAmount: computed.preEmi, // legacy mirror
        isFullyDisbursed: computed.isFullyDisbursed,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        disbursementId: disbursementRef.id,
        loanAggregates: {
          disbursedAmount: newDisbursed,
          totalLoanOutstanding: computed.totalLoanOutstanding,
          disbursementPercentage: computed.disbursementPercentage,
          emi: computed.emi,
          preEmi: computed.preEmi,
          isFullyDisbursed: computed.isFullyDisbursed,
        },
      };
    });

    logger.info("addDisbursement", { loanId: data.loanId, amount, utr });
    return result;
  },
);

function parseDate(iso: string | undefined): Date | null {
  if (!iso || typeof iso !== "string") return null;
  // Accept yyyy-mm-dd or full ISO strings.
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}
