/**
 * Pure home-loan math. No Firebase imports here so the module can be unit
 * tested or reused by clients.
 *
 * All amounts are stored as plain JS numbers in INR. We round monetary outputs
 * to two decimal places as a final step so tiny float drift doesn't leak into
 * persisted aggregates.
 *
 * Key model concepts (May 2026 rewrite):
 *   - EMI is computed on `disbursedAmount`, not the full sanction. This matches
 *     real-bank amortization on under-construction property where the bank only
 *     starts charging EMI on what it has actually paid out so far.
 *   - `repaymentType` controls whether the borrower pays interest-only
 *     ("PRE_EMI") or full amortizing EMI ("FULL_EMI") on the disbursed amount.
 *   - `emiAdjustmentType` controls what happens when more is disbursed:
 *       RECALCULATE_EMI         - keep tenure, raise EMI
 *       KEEP_EMI_EXTEND_TENURE  - keep EMI, push the maturity date out
 *   - `currentTenureMonths` (optional) is the active tenure after any
 *     KEEP_EMI_EXTEND_TENURE adjustments. `tenureMonths` is the originally
 *     sanctioned tenure and is left untouched.
 */

import { round2 } from "./money";

export type RepaymentType = "PRE_EMI" | "FULL_EMI";
export type EmiAdjustmentType = "RECALCULATE_EMI" | "KEEP_EMI_EXTEND_TENURE";

export const DEFAULT_REPAYMENT_TYPE: RepaymentType = "FULL_EMI";
export const DEFAULT_ADJUSTMENT_TYPE: EmiAdjustmentType = "RECALCULATE_EMI";

export function normaliseRepaymentType(v: unknown): RepaymentType {
  return v === "PRE_EMI" ? "PRE_EMI" : "FULL_EMI";
}
export function normaliseAdjustmentType(v: unknown): EmiAdjustmentType {
  return v === "KEEP_EMI_EXTEND_TENURE"
    ? "KEEP_EMI_EXTEND_TENURE"
    : "RECALCULATE_EMI";
}

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
 * @param principal       Disbursed loan amount on which EMI runs (NOT sanction)
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

/**
 * Solve for the tenure (in months) that makes a fixed EMI fully amortise a
 * given principal at a given rate. Used by KEEP_EMI_EXTEND_TENURE when more
 * money has just been disbursed.
 *
 *   n = ln(EMI / (EMI - P*r)) / ln(1 + r)
 *
 * Returns NaN if the EMI is too small to ever pay off the principal at this
 * rate (i.e. EMI <= P*r so principal grows each month).
 */
export function solveTenureForFixedEmi(
  principal: number,
  annualRatePct: number,
  emi: number,
): number {
  if (!Number.isFinite(principal) || principal <= 0) return 0;
  if (!Number.isFinite(emi) || emi <= 0) return NaN;
  if (!Number.isFinite(annualRatePct) || annualRatePct < 0) return NaN;
  if (annualRatePct === 0) return Math.ceil(principal / emi);

  const r = annualRatePct / 12 / 100;
  const monthlyInterestOnly = principal * r;
  if (emi <= monthlyInterestOnly + 1e-6) return NaN; // never amortizes

  const n = Math.log(emi / (emi - monthlyInterestOnly)) / Math.log(1 + r);
  return Math.ceil(n);
}

export interface LoanSnapshot {
  sanctionAmount: number;
  disbursedAmount: number;
  interestRate: number;
  /** Original sanctioned tenure in months. Used for fresh EMI calculations. */
  tenureMonths: number;
  /** Active tenure after any extensions. Falls back to tenureMonths. */
  currentTenureMonths?: number;
  repaymentType?: RepaymentType;
  emiAdjustmentType?: EmiAdjustmentType;
  /** EMI to honour when emiAdjustmentType === KEEP_EMI_EXTEND_TENURE. */
  fixedEmi?: number;
}

export interface LoanComputed {
  disbursementPercentage: number;
  totalLoanOutstanding: number;
  isFullyDisbursed: boolean;
  /** What the borrower pays each month, taking repaymentType into account. */
  monthlyPayment: number;
  /** Pre-EMI is what you actually pay during construction. Always populated. */
  preEmi: number;
  /** Full amortizing EMI on the currently disbursed amount. Always populated. */
  emi: number;
  /** Active tenure in months (may differ from tenureMonths after extensions). */
  currentTenureMonths: number;
  totalInterest: number;
  totalPayable: number;
  repaymentType: RepaymentType;
  emiAdjustmentType: EmiAdjustmentType;
}

/**
 * Pure derivation of every computed field we expose to clients.
 *
 * EMI is always computed against the DISBURSED amount, not the sanction. This
 * matches how real Indian banks bill on under-construction properties.
 */
export function computeLoanFields(snapshot: LoanSnapshot): LoanComputed {
  const sanctionAmount = Math.max(0, Number(snapshot.sanctionAmount) || 0);
  const disbursedAmount = Math.max(0, Number(snapshot.disbursedAmount) || 0);
  const interestRate = Math.max(0, Number(snapshot.interestRate) || 0);
  const tenureMonths = Math.max(0, Number(snapshot.tenureMonths) || 0);
  const repaymentType = normaliseRepaymentType(snapshot.repaymentType);
  const emiAdjustmentType = normaliseAdjustmentType(snapshot.emiAdjustmentType);

  const fullyDisbursed = sanctionAmount > 0 && disbursedAmount >= sanctionAmount;

  // Determine the active tenure used for amortization.
  let currentTenureMonths = Math.max(
    0,
    Number(snapshot.currentTenureMonths) || 0,
  ) || tenureMonths;

  // If the caller is in KEEP_EMI_EXTEND_TENURE mode and gave us a fixed EMI,
  // recompute the active tenure so the EMI still amortises the new principal.
  if (
    emiAdjustmentType === "KEEP_EMI_EXTEND_TENURE" &&
    Number(snapshot.fixedEmi) > 0 &&
    disbursedAmount > 0
  ) {
    const solved = solveTenureForFixedEmi(
      disbursedAmount,
      interestRate,
      Number(snapshot.fixedEmi),
    );
    if (Number.isFinite(solved) && solved > 0) {
      currentTenureMonths = solved;
    }
  }

  const breakdown = calculateEmi(disbursedAmount, interestRate, currentTenureMonths);
  const preEmi = calculatePreEmi(disbursedAmount, interestRate);

  // The actual monthly cheque the borrower writes.
  let monthlyPayment = 0;
  if (disbursedAmount > 0) {
    monthlyPayment = repaymentType === "PRE_EMI" ? preEmi : breakdown.emi;
  }

  return {
    disbursementPercentage: disbursementPercentage(disbursedAmount, sanctionAmount),
    totalLoanOutstanding: round2(Math.max(0, sanctionAmount - disbursedAmount)),
    isFullyDisbursed: fullyDisbursed,
    monthlyPayment,
    preEmi,
    emi: breakdown.emi,
    currentTenureMonths,
    totalInterest: breakdown.totalInterest,
    totalPayable: breakdown.totalPayable,
    repaymentType,
    emiAdjustmentType,
  };
}

/* ------------------------------------------------------------------------- *
 * Amortization schedule
 * ------------------------------------------------------------------------- */

export interface AmortizationRow {
  month: number;
  /** Calendar month label, optional - filled in by callers that have a start date. */
  monthLabel?: string;
  openingBalance: number;
  emi: number;
  interestComponent: number;
  principalComponent: number;
  closingBalance: number;
  /** Cumulative interest paid up to and including this month. */
  cumulativeInterest: number;
  /** Cumulative principal repaid up to and including this month. */
  cumulativePrincipal: number;
}

export interface AmortizationSchedule {
  rows: AmortizationRow[];
  summary: {
    repaymentType: RepaymentType;
    principal: number;
    interestRate: number;
    tenureMonths: number;
    monthlyPayment: number;
    totalInterest: number;
    totalPayable: number;
    /**
     * Closing balance at the end of the schedule. Should be 0 for FULL_EMI
     * (modulo rounding) and equal to principal for PRE_EMI.
     */
    finalBalance: number;
  };
  /** Convenience array shaped for charting libs (one point per month). */
  graph: Array<{
    month: number;
    interest: number;
    principal: number;
    balance: number;
  }>;
}

/**
 * Generate the full month-by-month amortization schedule.
 *
 *   FULL_EMI mode:
 *     interestComponent = openingBalance * (rate/12/100)
 *     principalComponent = EMI - interestComponent
 *     closingBalance     = openingBalance - principalComponent
 *
 *   PRE_EMI mode:
 *     monthly is interest-only; principal never reduces. The schedule still
 *     has `tenureMonths` rows so callers can render a realistic chart.
 *
 * The last row of FULL_EMI schedules adjusts its EMI by a few paise to make
 * the closingBalance exactly 0, soaking up rounding drift across the term.
 */
export function generateAmortizationSchedule(
  snapshot: LoanSnapshot,
  options: { startDate?: Date } = {},
): AmortizationSchedule {
  const computed = computeLoanFields(snapshot);
  const principal = Math.max(0, Number(snapshot.disbursedAmount) || 0);
  const annualRate = Math.max(0, Number(snapshot.interestRate) || 0);
  const months = computed.currentTenureMonths;
  const repaymentType = computed.repaymentType;
  const r = annualRate / 12 / 100;

  const rows: AmortizationRow[] = [];
  const graph: AmortizationSchedule["graph"] = [];

  if (months <= 0 || principal <= 0) {
    return {
      rows,
      summary: {
        repaymentType,
        principal,
        interestRate: annualRate,
        tenureMonths: months,
        monthlyPayment: computed.monthlyPayment,
        totalInterest: 0,
        totalPayable: 0,
        finalBalance: principal,
      },
      graph,
    };
  }

  let balance = principal;
  let cumulativeInterest = 0;
  let cumulativePrincipal = 0;

  for (let m = 1; m <= months; m++) {
    const opening = balance;
    let interest: number;
    let principalPart: number;
    let payment: number;

    if (repaymentType === "PRE_EMI") {
      interest = round2(opening * r);
      principalPart = 0;
      payment = interest;
      balance = opening; // PRE_EMI never reduces principal.
    } else {
      interest = round2(opening * r);
      let emi = computed.emi;
      // Last row: pay off the residue exactly.
      if (m === months) {
        payment = round2(opening + interest);
        principalPart = round2(opening);
        balance = 0;
        emi = payment;
      } else {
        payment = emi;
        principalPart = round2(payment - interest);
        balance = round2(opening - principalPart);
        if (balance < 0) {
          // shouldn't happen but guard against negative drift
          principalPart = round2(opening);
          balance = 0;
          payment = round2(principalPart + interest);
        }
      }
    }

    cumulativeInterest = round2(cumulativeInterest + interest);
    cumulativePrincipal = round2(cumulativePrincipal + principalPart);

    const row: AmortizationRow = {
      month: m,
      openingBalance: round2(opening),
      emi: round2(payment),
      interestComponent: interest,
      principalComponent: principalPart,
      closingBalance: round2(balance),
      cumulativeInterest,
      cumulativePrincipal,
    };

    if (options.startDate) {
      const d = new Date(options.startDate);
      d.setMonth(d.getMonth() + (m - 1));
      row.monthLabel = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    }

    rows.push(row);
    graph.push({
      month: m,
      interest: row.interestComponent,
      principal: row.principalComponent,
      balance: row.closingBalance,
    });
  }

  const totalInterest = rows.reduce((s, x) => s + x.interestComponent, 0);
  const totalPaid = rows.reduce((s, x) => s + x.emi, 0);

  return {
    rows,
    summary: {
      repaymentType,
      principal,
      interestRate: annualRate,
      tenureMonths: months,
      monthlyPayment: computed.monthlyPayment,
      totalInterest: round2(totalInterest),
      totalPayable: round2(totalPaid),
      finalBalance: round2(balance),
    },
    graph,
  };
}

/** Convenience for callers that pass tenure in years. */
export function tenureYearsToMonths(years: number | string | undefined): number {
  const n = Number(years);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 12);
}
