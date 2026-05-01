/**
 * Pure home-loan math. No Firebase imports here so the module can be unit
 * tested or reused by clients.
 *
 * All amounts are stored as plain JS numbers in INR. We round monetary outputs
 * to two decimal places as a final step so tiny float drift doesn't leak into
 * persisted aggregates.
 */

import { round2 } from "./money";

export interface EmiBreakdown {
  /** Standard fully-amortising EMI: principal + interest each month. */
  emi: number;
  /** Total interest payable across the full tenure (EMI scenario). */
  totalInterest: number;
  /** Total amount paid back to the bank (principal + interest). */
  totalPayable: number;
}

/**
 * Standard reducing-balance EMI:
 *
 *   EMI = P * r * (1 + r)^n / ((1 + r)^n - 1)
 *
 * @param principal       Disbursed loan amount on which EMI runs
 * @param annualRatePct   Annual interest rate, e.g. 8.5 for 8.5 %
 * @param tenureMonths    Tenure in months
 */
export function calculateEmi(
  principal: number,
  annualRatePct: number,
  tenureMonths: number,
): EmiBreakdown {
  if (!Number.isFinite(principal) || principal <= 0) {
    return { emi: 0, totalInterest: 0, totalPayable: 0 };
  }
  if (!Number.isFinite(annualRatePct) || annualRatePct < 0) {
    return { emi: 0, totalInterest: 0, totalPayable: 0 };
  }
  if (!Number.isFinite(tenureMonths) || tenureMonths <= 0) {
    return { emi: 0, totalInterest: 0, totalPayable: 0 };
  }

  // Zero-interest edge case (rare but cheap to handle correctly).
  if (annualRatePct === 0) {
    const emi = principal / tenureMonths;
    return {
      emi: round2(emi),
      totalInterest: 0,
      totalPayable: round2(principal),
    };
  }

  const r = annualRatePct / 12 / 100;
  const pow = Math.pow(1 + r, tenureMonths);
  const emi = (principal * r * pow) / (pow - 1);
  const totalPayable = emi * tenureMonths;
  const totalInterest = totalPayable - principal;

  return {
    emi: round2(emi),
    totalInterest: round2(totalInterest),
    totalPayable: round2(totalPayable),
  };
}

/**
 * Pre-EMI is interest-only on the amount disbursed so far. Charged during
 * the construction phase of an under-construction property until the loan
 * is fully disbursed.
 *
 *   preEmi = (disbursed * r) / (12 * 100)
 */
export function calculatePreEmi(disbursedAmount: number, annualRatePct: number): number {
  if (!Number.isFinite(disbursedAmount) || disbursedAmount <= 0) return 0;
  if (!Number.isFinite(annualRatePct) || annualRatePct <= 0) return 0;
  return round2((disbursedAmount * annualRatePct) / (12 * 100));
}

export function disbursementPercentage(disbursed: number, sanctioned: number): number {
  if (!Number.isFinite(sanctioned) || sanctioned <= 0) return 0;
  if (!Number.isFinite(disbursed) || disbursed <= 0) return 0;
  return round2((disbursed / sanctioned) * 100);
}

export interface LoanSnapshot {
  sanctionAmount: number;
  disbursedAmount: number;
  interestRate: number;
  tenureMonths: number;
}

export interface LoanComputed {
  disbursementPercentage: number;
  totalLoanOutstanding: number;
  isFullyDisbursed: boolean;
  /** Pre-EMI is what you actually pay during construction. */
  preEmi: number;
  /** EMI is what you'll pay once the loan is fully disbursed. */
  emi: number;
  totalInterest: number;
  totalPayable: number;
}

/** Pure derivation of every computed field we expose to clients. */
export function computeLoanFields(snapshot: LoanSnapshot): LoanComputed {
  const { sanctionAmount, disbursedAmount, interestRate, tenureMonths } = snapshot;
  const fullyDisbursed = disbursedAmount >= sanctionAmount && sanctionAmount > 0;
  const emiBreakdown = calculateEmi(sanctionAmount, interestRate, tenureMonths);
  const preEmi = fullyDisbursed ? 0 : calculatePreEmi(disbursedAmount, interestRate);

  return {
    disbursementPercentage: disbursementPercentage(disbursedAmount, sanctionAmount),
    totalLoanOutstanding: round2(Math.max(0, sanctionAmount - disbursedAmount)),
    isFullyDisbursed: fullyDisbursed,
    preEmi,
    emi: emiBreakdown.emi,
    totalInterest: emiBreakdown.totalInterest,
    totalPayable: emiBreakdown.totalPayable,
  };
}

/** Convenience for callers that pass tenure in years. */
export function tenureYearsToMonths(years: number | string | undefined): number {
  const n = Number(years);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 12);
}
