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
} from "./loan-math";

function expect(label: string, actual: number, expected: number, tol = 0.5) {
  const ok = Math.abs(actual - expected) < tol;
  // eslint-disable-next-line no-console
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${actual} (expected ~${expected})`);
}

// Reference values cross-checked against an HDFC EMI calculator.
const r = calculateEmi(5_000_000, 8.5, 360);
expect("EMI 50L @ 8.5% / 30y", r.emi, 38445.91, 1);

const pre = calculatePreEmi(2_500_000, 8.5);
expect("PreEMI on 25L @ 8.5%", pre, 17708.33, 1);

expect("Disbursement %", disbursementPercentage(3_500_000, 5_000_000), 70);

const computed = computeLoanFields({
  sanctionAmount: 5_000_000,
  disbursedAmount: 3_500_000,
  interestRate: 8.5,
  tenureMonths: 360,
});
expect("computed.outstanding", computed.totalLoanOutstanding, 1_500_000);
expect("computed.preEmi", computed.preEmi, 24791.67, 1);
expect("computed.emi", computed.emi, 38445.91, 1);
