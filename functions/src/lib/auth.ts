import { CallableRequest } from "firebase-functions/v2/https";
import { forbidden, unauthenticated } from "./errors";

/**
 * Email allow-list. Mirrors firestore.rules and the client-side
 * VITE_ALLOWED_EMAILS env var. Edit here when adding/removing co-owners.
 */
export const ALLOWED_EMAILS = [
  "chinchoretej@gmail.com",
  "dipalishirude7@gmail.com",
];

export interface CallerContext {
  uid: string;
  email: string;
}

/**
 * Use at the top of every callable: enforces auth + email allow-list.
 * Throws a typed HttpsError if either check fails.
 */
export function requireAllowedCaller<T>(req: CallableRequest<T>): CallerContext {
  const auth = req.auth;
  if (!auth?.uid) unauthenticated();

  const email = (auth.token.email ?? "").toLowerCase().trim();
  if (!email || !ALLOWED_EMAILS.includes(email)) {
    forbidden("This account is not authorised for FinancialHub", { email });
  }

  return { uid: auth.uid, email };
}
