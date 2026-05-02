/**
 * Quick sanity script for the pure loan-math module. Not wired into a
 * formal test runner - run with `node lib/lib/loan-math.test.js` after
 * `npm run build` if you want to verify the formulas.
 */
import {
  calculateEmi,
  calculatePreEmi,
  computeLoanFields,
  disbursementPercentage,
  generateAmortizationSchedule,
  solveTenureForFixedEmi,
} from "./loan-math";

let failures = 0;
function expect(label: string, actual: number, expected: number, tol = 0.5) {
  const ok = Math.abs(actual - expected) < tol;
  if (!ok) failures++;
  // eslint-disable-next-line no-console
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${actual} (expected ~${expected})`);
}

// ---------- baseline EMI / Pre-EMI ----------
const r = calculateEmi(5_000_000, 8.5, 360);
expect("EMI 50L @ 8.5% / 30y", r.emi, 38445.91, 1);

const pre = calculatePreEmi(2_500_000, 8.5);
expect("PreEMI on 25L @ 8.5%", pre, 17708.33, 1);

expect("Disbursement %", disbursementPercentage(3_500_000, 5_000_000), 70);

// ---------- computeLoanFields now uses DISBURSED amount ----------
const partial = computeLoanFields({
  sanctionAmount: 5_000_000,
  disbursedAmount: 3_500_000,
  interestRate: 8.5,
  tenureMonths: 360,
});
expect("partial.outstanding", partial.totalLoanOutstanding, 1_500_000);
expect("partial.preEmi", partial.preEmi, 24791.67, 1);
// EMI is now on the 35L disbursed, NOT on the 50L sanction.
expect("partial.emi (on disbursed 35L)", partial.emi, 26912.13, 1);
expect("partial.monthlyPayment FULL_EMI", partial.monthlyPayment, 26912.13, 1);

const preEmiMode = computeLoanFields({
  sanctionAmount: 5_000_000,
  disbursedAmount: 3_500_000,
  interestRate: 8.5,
  tenureMonths: 360,
  repaymentType: "PRE_EMI",
});
expect("preMode.monthlyPayment is interest-only", preEmiMode.monthlyPayment, 24791.67, 1);

// ---------- Solve tenure for fixed EMI ----------
// At 35L principal, 8.5%, with EMI fixed at 26912 -> ~360 months.
const solved = solveTenureForFixedEmi(3_500_000, 8.5, 26912.13);
expect("solveTenure(35L, 8.5%, 26912)", solved, 360, 2);

// Bumping principal modestly (35L -> 37.5L) while keeping EMI -> tenure must
// extend beyond the original 360 months. Using too big a jump (e.g. 50L) at
// 8.5% would put monthly-interest above the EMI and the function would
// (correctly) return NaN.
const extended = solveTenureForFixedEmi(3_750_000, 8.5, 26912.13);
expect("solveTenure(37.5L kept EMI)", extended > 360 && Number.isFinite(extended) ? 1 : 0, 1);

// EMI too low to amortise -> NaN
const impossible = solveTenureForFixedEmi(5_000_000, 8.5, 5_000);
expect("solveTenure unsolvable", Number.isNaN(impossible) ? 1 : 0, 1);

// ---------- Amortization schedule ----------
const sched = generateAmortizationSchedule({
  sanctionAmount: 5_000_000,
  disbursedAmount: 3_500_000,
  interestRate: 8.5,
  tenureMonths: 360,
});
expect("schedule rows count", sched.rows.length, 360);
expect("schedule first opening", sched.rows[0].openingBalance, 3_500_000, 1);
// First-month interest should equal openingBalance * monthlyRate.
expect("schedule first interest", sched.rows[0].interestComponent, 24791.67, 1);
// EMI - interest = principal component.
expect(
  "schedule first principal",
  sched.rows[0].principalComponent,
  26912.13 - 24791.67,
  1,
);
// Last row should clear the balance.
expect("schedule final balance", sched.rows[sched.rows.length - 1].closingBalance, 0, 0.5);
// Validation rule: EMI must be > first-month interest for FULL_EMI.
expect(
  "EMI > first interest",
  sched.rows[0].emi > sched.rows[0].interestComponent ? 1 : 0,
  1,
);

const preSched = generateAmortizationSchedule({
  sanctionAmount: 5_000_000,
  disbursedAmount: 3_500_000,
  interestRate: 8.5,
  tenureMonths: 12,
  repaymentType: "PRE_EMI",
});
expect("preSched final balance == principal", preSched.rows[preSched.rows.length - 1].closingBalance, 3_500_000, 1);
expect("preSched principal component is 0", preSched.rows[0].principalComponent, 0);
expect("preSched monthly is interest", preSched.rows[0].emi, 24791.67, 1);

// ---------- KEEP_EMI_EXTEND_TENURE behaviour ----------
// Original loan: 35L disbursed, 360 months, EMI ~26912.
// Then a fresh 2.5L disbursement comes in -> total 37.5L. With the EMI
// pinned, the active tenure must stretch beyond 360 months.
const kept = computeLoanFields({
  sanctionAmount: 5_000_000,
  disbursedAmount: 3_750_000,
  interestRate: 8.5,
  tenureMonths: 360,
  emiAdjustmentType: "KEEP_EMI_EXTEND_TENURE",
  fixedEmi: 26912.13,
});
expect("kept tenure extends past 360", kept.currentTenureMonths > 360 ? 1 : 0, 1);

// eslint-disable-next-line no-console
console.log(failures === 0 ? "All checks passed." : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
