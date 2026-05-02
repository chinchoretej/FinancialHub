import { onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { requireAllowedCaller } from "../lib/auth";
import { badRequest, conflict, notFound } from "../lib/errors";
import { Collections, db, FieldValue, Timestamp } from "../lib/firestore";
import {
  computeLoanFields,
  normaliseAdjustmentType,
  normaliseRepaymentType,
  tenureYearsToMonths,
} from "../lib/loan-math";
import {
  isPositiveAmount,
  normaliseUtr,
  parseAmount,
  round2,
} from "../lib/money";

export interface UpdateDisbursementRequest {
  disbursementId: string;
  /**
   * Any field omitted (or set to undefined) is left untouched. `null` is
   * treated as a positive intent to clear nullable fields like stageId /
   * demandId / remarks.
   */
  amount?: number | string | null;
  /** ISO yyyy-mm-dd */
  disbursementDate?: string | null;
  utrNumber?: string | null;
  stageId?: string | null;
  demandId?: string | null;
  remarks?: string | null;
}

/**
 * Atomically edit a disbursement and re-derive the loan aggregates.
 *
 * The disbursement's `loanId` is intentionally not editable: switching a
 * tranche between two loans would require recomputing both, plus a tricky
 * cross-loan UTR move. Users wanting that behaviour should
 * [delete + re-add] instead.
 *
 * Steps inside a Firestore transaction:
 *   1. Read disbursement, parent loan, and (if the UTR is changing) both
 *      old and new utrIndex docs.
 *   2. Validate amount > 0 (if changing) and ensure the new UTR isn't
 *      already claimed by another doc.
 *   3. Recompute the loan aggregates with the amount delta applied.
 *   4. Apply: update the disbursement doc, swap the UTR claim if needed,
 *      and update the loan aggregates.
 */
export const updateDisbursement = onCall<UpdateDisbursementRequest>(
  { region: "asia-south1", cors: true },
  async (req) => {
    const caller = requireAllowedCaller(req);
    const data = req.data ?? ({} as UpdateDisbursementRequest);
    if (!data.disbursementId || typeof data.disbursementId !== "string") {
      badRequest("disbursementId is required");
    }

    const disbRef = db.collection(Collections.Disbursements).doc(data.disbursementId);

    const result = await db.runTransaction(async (tx) => {
      const disbSnap = await tx.get(disbRef);
      if (!disbSnap.exists) {
        notFound(`Disbursement ${data.disbursementId} not found`);
      }
      const existing = disbSnap.data() ?? {};
      const loanId = (existing.loanId as string | undefined) ?? "";
      const oldAmount = Number(existing.amount) || 0;
      const oldUtr = ((existing.utrNumber as string | undefined) ?? "").toUpperCase().trim();

      if (!loanId) {
        badRequest("Disbursement has no loanId on file - cannot recompute aggregates");
      }

      const loanRef = db.collection(Collections.Loans).doc(loanId);

      // -------------------- resolve new field values --------------------
      const amountChanging = data.amount !== undefined;
      let newAmount = oldAmount;
      if (amountChanging) {
        if (data.amount === null) badRequest("amount cannot be null");
        newAmount = parseAmount(data.amount);
        if (!isPositiveAmount(newAmount)) {
          badRequest("amount must be a positive number");
        }
      }

      const utrChanging = data.utrNumber !== undefined;
      let newUtr = oldUtr;
      if (utrChanging) {
        if (data.utrNumber === null || data.utrNumber === "") {
          badRequest("utrNumber is required");
        }
        newUtr = normaliseUtr(data.utrNumber as string);
        if (!newUtr) badRequest("utrNumber is required");
        if (newUtr.length < 6) badRequest("utrNumber looks too short");
      }

      const dateChanging = data.disbursementDate !== undefined;
      let newDate: Date | null = null;
      if (dateChanging) {
        if (!data.disbursementDate) {
          badRequest("disbursementDate must be a valid ISO date (yyyy-mm-dd)");
        }
        newDate = parseDate(data.disbursementDate);
        if (!newDate) {
          badRequest("disbursementDate must be a valid ISO date (yyyy-mm-dd)");
        }
      }

      const utrSwap = utrChanging && newUtr !== oldUtr;
      const oldUtrRef = oldUtr ? db.collection(Collections.UtrIndex).doc(oldUtr) : null;
      const newUtrRef = utrSwap && newUtr ? db.collection(Collections.UtrIndex).doc(newUtr) : null;

      // -------------------- reads --------------------
      const [loanSnap, oldUtrSnap, newUtrSnap] = await Promise.all([
        tx.get(loanRef),
        oldUtrRef ? tx.get(oldUtrRef) : Promise.resolve(null),
        newUtrRef ? tx.get(newUtrRef) : Promise.resolve(null),
      ]);
      if (!loanSnap.exists) notFound(`Loan ${loanId} not found`);

      if (utrSwap && newUtrRef && newUtrSnap?.exists) {
        conflict(`UTR ${newUtr} has already been recorded`, {
          conflictingRefId: newUtrSnap.get("refId"),
          conflictingType: newUtrSnap.get("type"),
        });
      }

      const loan = loanSnap.data() ?? {};
      const sanctionAmount = Number(loan.sanctionAmount) || 0;
      const previousDisbursed =
        Number(loan.disbursedAmount) || Number(loan.totalDisbursed) || 0;
      const newDisbursed = round2(Math.max(0, previousDisbursed - oldAmount + newAmount));

      if (sanctionAmount > 0 && newDisbursed > sanctionAmount + 0.01) {
        badRequest(
          `Updated disbursement would exceed sanction amount ` +
            `(${newDisbursed} > ${sanctionAmount})`,
          { sanctionAmount, attemptedDisbursed: newDisbursed },
        );
      }

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

      // -------------------- writes --------------------
      // UTR swap: drop old (if it still points at us), claim new.
      if (utrSwap) {
        if (oldUtrRef && oldUtrSnap?.exists && oldUtrSnap.get("refId") === data.disbursementId) {
          tx.delete(oldUtrRef);
        }
        if (newUtrRef) {
          tx.create(newUtrRef, {
            type: "disbursement",
            refId: data.disbursementId,
            loanId,
            amount: newAmount,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: caller.uid,
          });
        }
      } else if (amountChanging && oldUtrRef && oldUtrSnap?.exists) {
        // UTR unchanged but amount moved - keep the index in sync so any
        // dashboards reading utrIndex.amount stay accurate.
        tx.update(oldUtrRef, { amount: newAmount });
      }

      const disbUpdate: Record<string, unknown> = {
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: caller.uid,
      };
      if (amountChanging) disbUpdate.amount = newAmount;
      if (utrSwap) disbUpdate.utrNumber = newUtr;
      if (dateChanging && newDate) {
        disbUpdate.disbursementDate = Timestamp.fromDate(newDate);
      }
      if (data.stageId !== undefined) {
        disbUpdate.stageId = (data.stageId ?? "").toString().trim() || null;
      }
      if (data.demandId !== undefined) {
        disbUpdate.demandId = (data.demandId ?? "").toString().trim() || null;
      }
      if (data.remarks !== undefined) {
        disbUpdate.remarks = (data.remarks ?? "").toString().slice(0, 500);
      }
      tx.update(disbRef, disbUpdate);

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
        disbursementId: data.disbursementId,
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

    logger.info("updateDisbursement", { disbursementId: data.disbursementId });
    return result;
  },
);

function parseDate(iso: string | undefined | null): Date | null {
  if (!iso || typeof iso !== "string") return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}
