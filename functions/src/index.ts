/**
 * Cloud Functions entry point.
 *
 * Region: asia-south1 (Mumbai) for low latency from India.
 * All callables share the same entry contract:
 *   - Auth required (Firebase ID token)
 *   - Caller email must be in the allow-list (see lib/auth.ts)
 *   - Errors surface as typed HttpsError codes:
 *       invalid-argument   - validation failed
 *       already-exists     - duplicate UTR / stage name
 *       not-found          - loan / stage doesn't exist
 *       permission-denied  - email not allow-listed
 *       unauthenticated    - no auth token
 *
 * Deploy with:  npm --prefix functions run deploy
 */

export { calculateLoanDetails } from "./loan/calculateLoanDetails";
export { getLoanSummary } from "./loan/getLoanSummary";
export { recomputeLoanAggregates } from "./loan/recomputeLoanAggregates";

export { addDisbursement } from "./disbursement/addDisbursement";
export { addBuilderStage } from "./builderStage/addBuilderStage";
export { addBuilderPayment } from "./builderPayment/addBuilderPayment";
