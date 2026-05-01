import { onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { requireAllowedCaller } from "../lib/auth";
import { badRequest, conflict, notFound } from "../lib/errors";
import { Collections, db, FieldValue, Timestamp } from "../lib/firestore";
import {
  isNonNegativeAmount,
  isPositiveAmount,
  normaliseUtr,
  parseAmount,
  round2,
} from "../lib/money";

interface AddBuilderPaymentRequest {
  stageId: string;
  amount: number | string;
  gstAmount?: number | string;
  paidBy: "self" | "bank" | "Self" | "Bank";
  paymentDate: string; // ISO yyyy-mm-dd
  utrNumber: string;
  notes?: string;
}

/**
 * Atomically:
 *   1. validates input (positive amount, optional non-negative GST, UTR present)
 *   2. claims UTR (rejects duplicate)
 *   3. checks payment fits within stage.remainingAmount
 *   4. writes builderPayment doc (totalAmount = amount + gst)
 *   5. increments stage.totalPaid / totalGstPaid / remainingAmount,
 *      flips status (pending → partial → paid) and bumps updatedAt.
 */
export const addBuilderPayment = onCall<AddBuilderPaymentRequest>(
  { region: "asia-south1", cors: true },
  async (req) => {
    const caller = requireAllowedCaller(req);
    const data = req.data ?? ({} as AddBuilderPaymentRequest);

    if (!data.stageId || typeof data.stageId !== "string") {
      badRequest("stageId is required");
    }

    const amount = parseAmount(data.amount);
    if (!isPositiveAmount(amount)) {
      badRequest("amount must be a positive number");
    }

    const gstAmount = parseAmount(data.gstAmount ?? 0);
    if (!isNonNegativeAmount(gstAmount)) {
      badRequest("gstAmount must be zero or positive");
    }

    const utr = normaliseUtr(data.utrNumber);
    if (!utr) badRequest("utrNumber is required");
    if (utr.length < 6) badRequest("utrNumber looks too short");

    const paidBy = (data.paidBy ?? "").toString().toLowerCase();
    if (paidBy !== "self" && paidBy !== "bank") {
      badRequest("paidBy must be either 'self' or 'bank'");
    }

    const paymentDate = parseDate(data.paymentDate);
    if (!paymentDate) {
      badRequest("paymentDate must be a valid ISO date (yyyy-mm-dd)");
    }

    const totalAmount = round2(amount + gstAmount);
    const notes = (data.notes ?? "").toString().slice(0, 500);

    const stageRef = db.collection(Collections.BuilderStages).doc(data.stageId);
    const utrRef = db.collection(Collections.UtrIndex).doc(utr);
    const paymentRef = db.collection(Collections.BuilderPayments).doc();

    const result = await db.runTransaction(async (tx) => {
      const [stageSnap, utrSnap] = await Promise.all([
        tx.get(stageRef),
        tx.get(utrRef),
      ]);

      if (!stageSnap.exists) notFound(`Builder stage ${data.stageId} not found`);
      if (utrSnap.exists) {
        conflict(`UTR ${utr} has already been recorded`, {
          conflictingRefId: utrSnap.get("refId"),
          conflictingType: utrSnap.get("type"),
        });
      }

      const stage = stageSnap.data() ?? {};
      const expectedAmount = Number(stage.expectedAmount) || 0;
      const previousTotalPaid = Number(stage.totalPaid) || 0;
      const previousTotalGst = Number(stage.totalGstPaid) || 0;
      const newTotalPaid = round2(previousTotalPaid + totalAmount);
      const newTotalGst = round2(previousTotalGst + gstAmount);

      if (expectedAmount > 0 && newTotalPaid > expectedAmount + 0.01) {
        badRequest(
          `Payment would exceed stage expected amount ` +
            `(${newTotalPaid} > ${expectedAmount})`,
          { expectedAmount, attempted: newTotalPaid },
        );
      }

      const remaining = round2(Math.max(0, expectedAmount - newTotalPaid));
      const status =
        newTotalPaid + 0.01 >= expectedAmount && expectedAmount > 0
          ? "paid"
          : newTotalPaid > 0
            ? "partial"
            : "pending";

      // 1. Claim UTR.
      tx.create(utrRef, {
        type: "builderPayment",
        refId: paymentRef.id,
        stageId: data.stageId,
        amount: totalAmount,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: caller.uid,
      });

      // 2. Write payment.
      tx.create(paymentRef, {
        stageId: data.stageId,
        loanId: stage.loanId ?? null,
        amount: round2(amount),
        gstAmount: round2(gstAmount),
        totalAmount,
        paidBy,
        paymentDate: Timestamp.fromDate(paymentDate),
        utrNumber: utr,
        notes,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: caller.uid,
      });

      // 3. Bump stage aggregates.
      tx.update(stageRef, {
        totalPaid: newTotalPaid,
        totalGstPaid: newTotalGst,
        remainingAmount: remaining,
        status,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        paymentId: paymentRef.id,
        stageAggregates: {
          stageId: data.stageId,
          totalPaid: newTotalPaid,
          remainingAmount: remaining,
          status,
        },
        totalAmount,
      };
    });

    logger.info("addBuilderPayment", { stageId: data.stageId, totalAmount, utr });
    return result;
  },
);

function parseDate(iso: string | undefined): Date | null {
  if (!iso || typeof iso !== "string") return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}
