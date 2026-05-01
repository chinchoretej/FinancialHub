import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();

export const db = getFirestore();
export { FieldValue, Timestamp };

/** Canonical collection names. Use these everywhere instead of magic strings. */
export const Collections = {
  Loans: "loans",
  Disbursements: "disbursements",
  BuilderStages: "builderStages",
  BuilderPayments: "builderPayments",
  UtrIndex: "utrIndex",
  ProjectMeta: "projectMeta",
  // Legacy collections kept for backward compatibility with the existing
  // web/Android clients. Functions don't write here.
  Demands: "demands",
  Payments: "payments",
  FlatCost: "flatCost",
} as const;
