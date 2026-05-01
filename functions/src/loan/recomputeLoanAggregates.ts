import { onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { requireAllowedCaller } from "../lib/auth";
import { badRequest, notFound } from "../lib/errors";
import { Collections, db, FieldValue } from "../lib/firestore";
import { computeLoanFields, tenureYearsToMonths } from "../lib/loan-math";
import { round2 } from "../lib/money";

interface RecomputeRequest {
  loanId: string;
}

/**
 * Repair tool. Re-derives loans/{loanId}.disbursedAmount and all computed
 * fields by re-summing disbursements/{*} where loanId matches. Use when:
 *   - a write was made directly to Firestore bypassing the callable
 *   - you migrated old documents into the new collections
 *   - you suspect drift between aggregates and source-of-truth docs
 *
 * Stages are also re-aggregated by summing builderPayments for each stage.
 */
export const recomputeLoanAggregates = onCall<RecomputeRequest>(
  { region: "asia-south1", cors: true },
  async (req) => {
    requireAllowedCaller(req);
    const loanId = req.data?.loanId;
    if (!loanId) badRequest("loanId is required");

    const loanRef = db.collection(Collections.Loans).doc(loanId);
    const loanSnap = await loanRef.get();
    if (!loanSnap.exists) notFound(`Loan ${loanId} not found`);

    const [disbursementsSnap, stagesSnap] = await Promise.all([
      db
        .collection(Collections.Disbursements)
        .where("loanId", "==", loanId)
        .get(),
      db
        .collection(Collections.BuilderStages)
        .where("loanId", "==", loanId)
        .get(),
    ]);

    const disbursedAmount = round2(
      disbursementsSnap.docs.reduce(
        (s, d) => s + (Number(d.get("amount")) || 0),
        0,
      ),
    );
    const loan = loanSnap.data() ?? {};
    const sanctionAmount = Number(loan.sanctionAmount) || 0;
    const tenureMonths =
      Number(loan.tenureMonths) ||
      tenureYearsToMonths(loan.tenureYears) ||
      Number(loan.tenure) ||
      0;
    const computed = computeLoanFields({
      sanctionAmount,
      disbursedAmount,
      interestRate: Number(loan.interestRate) || 0,
      tenureMonths,
    });

    // Re-aggregate each stage from its payments.
    const stageUpdates: Promise<unknown>[] = [];
    for (const stageDoc of stagesSnap.docs) {
      const stageId = stageDoc.id;
      const expectedAmount = Number(stageDoc.get("expectedAmount")) || 0;
      const paymentsSnap = await db
        .collection(Collections.BuilderPayments)
        .where("stageId", "==", stageId)
        .get();
      const totalPaid = round2(
        paymentsSnap.docs.reduce(
          (s, d) => s + (Number(d.get("totalAmount")) || 0),
          0,
        ),
      );
      const totalGstPaid = round2(
        paymentsSnap.docs.reduce(
          (s, d) => s + (Number(d.get("gstAmount")) || 0),
          0,
        ),
      );
      const remainingAmount = round2(Math.max(0, expectedAmount - totalPaid));
      const status =
        totalPaid + 0.01 >= expectedAmount && expectedAmount > 0
          ? "paid"
          : totalPaid > 0
            ? "partial"
            : "pending";
      stageUpdates.push(
        stageDoc.ref.update({
          totalPaid,
          totalGstPaid,
          remainingAmount,
          status,
          updatedAt: FieldValue.serverTimestamp(),
        }),
      );
    }

    await Promise.all([
      loanRef.update({
        disbursedAmount,
        totalDisbursed: disbursedAmount,
        remainingAmount: computed.totalLoanOutstanding,
        totalLoanOutstanding: computed.totalLoanOutstanding,
        disbursementPercentage: computed.disbursementPercentage,
        emi: computed.emi,
        emiAmount: computed.emi,
        preEmi: computed.preEmi,
        preEmiAmount: computed.preEmi,
        isFullyDisbursed: computed.isFullyDisbursed,
        updatedAt: FieldValue.serverTimestamp(),
      }),
      ...stageUpdates,
    ]);

    logger.info("recomputeLoanAggregates", {
      loanId,
      disbursementsCounted: disbursementsSnap.size,
      stagesUpdated: stagesSnap.size,
    });

    return {
      loanId,
      loanAggregates: {
        disbursedAmount,
        totalLoanOutstanding: computed.totalLoanOutstanding,
        disbursementPercentage: computed.disbursementPercentage,
        emi: computed.emi,
        preEmi: computed.preEmi,
      },
      stagesUpdated: stagesSnap.size,
    };
  },
);
