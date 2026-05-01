import { HttpsError } from "firebase-functions/v2/https";

/**
 * Helper to raise a typed HttpsError with consistent shapes. Cloud Functions
 * v2 will surface these to callers as code/message and an optional details
 * payload that the client can switch on.
 */
export function badRequest(message: string, details?: Record<string, unknown>): never {
  throw new HttpsError("invalid-argument", message, details);
}

export function conflict(message: string, details?: Record<string, unknown>): never {
  throw new HttpsError("already-exists", message, details);
}

export function notFound(message: string, details?: Record<string, unknown>): never {
  throw new HttpsError("not-found", message, details);
}

export function forbidden(message: string, details?: Record<string, unknown>): never {
  throw new HttpsError("permission-denied", message, details);
}

export function unauthenticated(message = "Sign-in required"): never {
  throw new HttpsError("unauthenticated", message);
}
