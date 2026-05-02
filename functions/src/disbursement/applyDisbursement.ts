import { onCall } from "firebase-functions/v2/https";
import { handleAddDisbursement, AddDisbursementRequest } from "./addDisbursement";

/**
 * Spec-compatible alias for [[addDisbursement]].
 *
 * The May 2026 amortization spec calls this entry point `applyDisbursement`.
 * It shares the same handler so existing clients (web + Android) calling
 * `addDisbursement` keep working byte-for-byte while new integrations can use
 * the spec name.
 *
 * NOTE: we deploy two callables that wrap the same handler. That means each
 * gets its own cold-start instance, which is fine for our traffic but worth
 * keeping in mind if invocation counts ever matter.
 */
export const applyDisbursement = onCall<AddDisbursementRequest>(
  { region: "asia-south1", cors: true },
  handleAddDisbursement,
);
