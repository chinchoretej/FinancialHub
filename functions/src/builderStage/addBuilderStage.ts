import { onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { requireAllowedCaller } from "../lib/auth";
import { badRequest, conflict } from "../lib/errors";
import { Collections, db, FieldValue } from "../lib/firestore";
import {
  isPositiveAmount,
  parseAmount,
  round2,
} from "../lib/money";

interface AddBuilderStageRequest {
  loanId?: string; // optional grouping
  stageName: string;
  /** percentage of the agreement value, e.g. 10 for 10 %. */
  percentage: number | string;
  /**
   * If omitted we read it from projectMeta/{loanId} or the most recent
   * flatCost doc - whichever is available.
   */
  agreementValue?: number | string;
  order?: number;
}

/**
 * Creates a new builder stage with expectedAmount derived from percentage.
 * Total of all stages for a given loanId may not exceed 100 %.
 */
export const addBuilderStage = onCall<AddBuilderStageRequest>(
  { region: "asia-south1", cors: true },
  async (req) => {
    const caller = requireAllowedCaller(req);
    const data = req.data ?? ({} as AddBuilderStageRequest);

    const stageName = (data.stageName ?? "").toString().trim();
    if (!stageName) badRequest("stageName is required");

    const percentage = parseAmount(data.percentage);
    if (!isPositiveAmount(percentage) || percentage > 100) {
      badRequest("percentage must be between 0 and 100");
    }

    const loanId = data.loanId?.trim() || null;

    let agreementValue = parseAmount(data.agreementValue);
    if (!isPositiveAmount(agreementValue)) {
      agreementValue = await resolveAgreementValue(loanId);
    }
    if (!isPositiveAmount(agreementValue)) {
      badRequest(
        "agreementValue could not be resolved - pass it explicitly or set it on projectMeta/flatCost",
      );
    }

    const stageRef = db.collection(Collections.BuilderStages).doc();
    const expectedAmount = round2((agreementValue * percentage) / 100);

    const result = await db.runTransaction(async (tx) => {
      // Sum-of-percentages guard.
      const existingQuery = await tx.get(
        db
          .collection(Collections.BuilderStages)
          .where("loanId", "==", loanId),
      );
      const existingPctSum = existingQuery.docs.reduce(
        (sum, d) => sum + (Number(d.get("percentage")) || 0),
        0,
      );
      if (round2(existingPctSum + percentage) > 100.01) {
        conflict(
          `Sum of stage percentages would exceed 100 % ` +
            `(existing ${existingPctSum} + new ${percentage})`,
          { existingPctSum, attempted: round2(existingPctSum + percentage) },
        );
      }

      // Duplicate name guard within the same loan.
      const dupe = existingQuery.docs.find(
        (d) =>
          (d.get("stageName") ?? "").toString().trim().toLowerCase() ===
          stageName.toLowerCase(),
      );
      if (dupe) {
        conflict(`A stage named "${stageName}" already exists for this loan`, {
          conflictingId: dupe.id,
        });
      }

      tx.create(stageRef, {
        loanId,
        stageName,
        percentage: round2(percentage),
        agreementValue: round2(agreementValue),
        expectedAmount,
        order: Number(data.order) || existingQuery.size + 1,
        totalPaid: 0,
        totalGstPaid: 0,
        remainingAmount: expectedAmount,
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: caller.uid,
      });

      return {
        stageId: stageRef.id,
        stageName,
        percentage: round2(percentage),
        expectedAmount,
      };
    });

    logger.info("addBuilderStage", result);
    return result;
  },
);

/**
 * Best-effort resolver. We try projectMeta/{loanId} first (if the user has
 * set up the new project model), then fall back to the legacy flatCost
 * collection's most recent doc.
 */
async function resolveAgreementValue(loanId: string | null): Promise<number> {
  if (loanId) {
    const projSnap = await db
      .collection(Collections.ProjectMeta)
      .doc(loanId)
      .get();
    if (projSnap.exists) {
      const v = parseAmount(projSnap.get("agreementValue"));
      if (isPositiveAmount(v)) return v;
    }
  }
  const fcSnap = await db
    .collection(Collections.FlatCost)
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();
  if (!fcSnap.empty) {
    const v = parseAmount(fcSnap.docs[0].get("agreementValue"));
    if (isPositiveAmount(v)) return v;
  }
  return 0;
}
