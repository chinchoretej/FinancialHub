/**
 * Money / numeric helpers used everywhere we accept user-supplied amounts.
 * All amounts are INR.
 */

/** Round to 2 decimal places without ever returning -0.00 or NaN. */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Coerce client-supplied amount strings/numbers into a positive finite
 * number. Returns NaN for anything that isn't a valid amount so callers
 * can fail loudly via assertPositiveAmount.
 */
export function parseAmount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value === "string") {
    const cleaned = value.replace(/[, ₹]/g, "").trim();
    if (cleaned === "") return NaN;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

export function isPositiveAmount(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

export function isNonNegativeAmount(n: number): boolean {
  return Number.isFinite(n) && n >= 0;
}

/** "₹1,23,456.78" - matches the Indian locale used elsewhere in the app. */
export function formatRupees(n: number): string {
  if (!Number.isFinite(n)) return "₹0.00";
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Sanitise a UTR / transaction reference. We keep alphanumerics only and
 * upper-case so "abc 12-34" and "ABC1234" collide on the unique index.
 */
export function normaliseUtr(utr: unknown): string {
  if (typeof utr !== "string") return "";
  return utr.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}
