import { onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { requireAllowedCaller } from "../lib/auth";
import { badRequest, notFound } from "../lib/errors";
import { Collections, db } from "../lib/firestore";
import {
  computeLoanFields,
  normaliseAdjustmentType,
  normaliseRepaymentType,
  tenureYearsToMonths,
} from "../lib/loan-math";
import { round2 } from "../lib/money";

interface GetLoanSummaryRequest {
  loanId: string;
}

/**
 * One-shot dashboard payload: loan + computed fields + disbursement timeline
 * + builder stages with their payment aggregates + builder-side totals.
 *
 * Designed to fill the entire Loan tab from a single round-trip and to be
 * cheap on cold start since it doesn't write anywhere.
 */
export const getLoanSummary = onCall<GetLoanSummaryRequest>(
  { region: "asia-south1", cors: true },
  async (req) => {
    requireAllowedCaller(req);
    const loanId = req.data?.loanId;
    if (!loanId) badRequest("loanId is required");

    const loanRef = db.collection(Collections.Loans).doc(loanId);
    const [loanSnap, disbursementsSnap, stagesSnap] = await Promise.all([
      loanRef.get(),
      db
        .collection(Collections.Disbursements)
        .where("loanId", "==", loanId)
        .orderBy("disbursementDate", "desc")
        .get(),
      db
        .collection(Collections.BuilderStages)
        .where("loanId", "==", loanId)
        .orderBy("order", "asc")
        .get(),
    ]);

    if (!loanSnap.exists) notFound(`Loan ${loanId} not found`);

    const loan = loanSnap.data() ?? {};
    const sanctionAmount = Number(loan.sanctionAmount) || 0;
    const disbursedAmount = round2(
      disbursementsSnap.docs.reduce(
        (sum, d) => sum + (Number(d.get("amount")) || 0),
        0,
      ),
    );
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
      currentTenureMonths: Number(loan.currentTenureMonths) || undefined,
      repaymentType: normaliseRepaymentType(loan.repaymentType),
      emiAdjustmentType: normaliseAdjustmentType(loan.emiAdjustmentType),
      fixedEmi: Number(loan.fixedEmi) || undefined,
    });

    // Pull builderPayments per stage in parallel rather than via a single
    // collectionGroup query - simpler permissions story and easier to cache.
    const stageIds = stagesSnap.docs.map((d) => d.id);
    const paymentsByStage: Record<string, FirebaseFirestore.DocumentData[]> = {};
    if (stageIds.length > 0) {
      const chunks = chunk(stageIds, 10); // Firestore "in" limit
      const lists = await Promise.all(
        chunks.map((ids) =>
          db
            .collection(Collections.BuilderPayments)
            .where("stageId", "in", ids)
            .get(),
        ),
      );
      for (const list of lists) {
        for (const doc of list.docs) {
          const stageId = doc.get("stageId") as string;
          (paymentsByStage[stageId] ||= []).push({ id: doc.id, ...doc.data() });
        }
      }
    }

    type StageDoc = FirebaseFirestore.DocumentData & {
      id: string;
      totalPaid?: number;
      expectedAmount?: number;
      payments: FirebaseFirestore.DocumentData[];
    };
    const stages: StageDoc[] = stagesSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
      payments: paymentsByStage[d.id] ?? [],
    }));

    const totalPaidToBuilder = round2(
      stages.reduce((s, st) => s + (Number(st.totalPaid) || 0), 0),
    );
    const totalBuilderExpected = round2(
      stages.reduce((s, st) => s + (Number(st.expectedAmount) || 0), 0),
    );
    const remainingBuilderAmount = round2(
      Math.max(0, totalBuilderExpected - totalPaidToBuilder),
    );

    const summary = {
      loan: {
        id: loanSnap.id,
        ...loan,
        // Re-stamp the computed fields so callers always get fresh values
        // even if the persisted aggregate has drifted.
        disbursedAmount,
        ...computed,
      },
      disbursements: disbursementsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      builder: {
        stages,
        totalExpected: totalBuilderExpected,
        totalPaidToBuilder,
        remainingBuilderAmount,
      },
    };

    logger.info("getLoanSummary", {
      loanId,
      disbursementCount: disbursementsSnap.size,
      stageCount: stagesSnap.size,
    });
    return summary;
  },
);

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
