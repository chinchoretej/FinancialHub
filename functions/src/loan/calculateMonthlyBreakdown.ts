import { onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { requireAllowedCaller } from "../lib/auth";
import { badRequest, notFound } from "../lib/errors";
import { Collections, db } from "../lib/firestore";
import {
  computeLoanFields,
  generateAmortizationSchedule,
  normaliseAdjustmentType,
  normaliseRepaymentType,
  tenureYearsToMonths,
} from "../lib/loan-math";
import { round2 } from "../lib/money";

interface MonthlyBreakdownRequest {
  loanId: string;
  /** Optional - first row of the breakdown is dated from this. Server time otherwise. */
  startDate?: string;
}

/**
 * Chart-ready monthly breakdown of EMI / Pre-EMI versus interest, principal
 * and outstanding balance. This is a thin transform on top of
 * generateAmortizationSchedule that:
 *
 *   - bins rows into yearly buckets too, so dashboards can plot either at
 *     monthly or yearly granularity without re-aggregating on the client.
 *   - returns chart-friendly arrays (`labels`, `interest[]`, `principal[]`,
 *     `balance[]`) shaped so any charting lib (Chart.js, Recharts, MPAndroid)
 *     can consume them directly.
 *
 * Pure read-only.
 */
export const calculateMonthlyBreakdown = onCall<MonthlyBreakdownRequest>(
  { region: "asia-south1", cors: true },
  async (req) => {
    requireAllowedCaller(req);
    const { loanId, startDate } = req.data ?? {};
    if (!loanId) badRequest("loanId is required");

    const snap = await db.collection(Collections.Loans).doc(loanId).get();
    if (!snap.exists) notFound(`Loan ${loanId} not found`);
    const data = snap.data() ?? {};

    const tenureMonths =
      Number(data.tenureMonths) ||
      tenureYearsToMonths(data.tenureYears) ||
      Number(data.tenure) ||
      0;

    const snapshot = {
      sanctionAmount: Number(data.sanctionAmount) || 0,
      disbursedAmount:
        Number(data.disbursedAmount) || Number(data.totalDisbursed) || 0,
      interestRate: Number(data.interestRate) || 0,
      tenureMonths,
      currentTenureMonths: Number(data.currentTenureMonths) || undefined,
      repaymentType: normaliseRepaymentType(data.repaymentType),
      emiAdjustmentType: normaliseAdjustmentType(data.emiAdjustmentType),
      fixedEmi: Number(data.fixedEmi) || undefined,
    };

    const start = parseStartDate(startDate);
    const computed = computeLoanFields(snapshot);
    const schedule = generateAmortizationSchedule(snapshot, { startDate: start });

    // Yearly aggregation (handy for "interest paid per year" charts).
    type YearBucket = {
      year: number;
      interest: number;
      principal: number;
      payment: number;
      closingBalance: number;
    };
    const buckets: Record<number, YearBucket> = {};
    schedule.rows.forEach((row, idx) => {
      const yearIndex = Math.floor(idx / 12) + 1;
      if (!buckets[yearIndex]) {
        buckets[yearIndex] = {
          year: yearIndex,
          interest: 0,
          principal: 0,
          payment: 0,
          closingBalance: row.closingBalance,
        };
      }
      const b = buckets[yearIndex];
      b.interest = round2(b.interest + row.interestComponent);
      b.principal = round2(b.principal + row.principalComponent);
      b.payment = round2(b.payment + row.emi);
      b.closingBalance = row.closingBalance; // last row of the year wins
    });
    const yearly = Object.values(buckets).sort((a, b) => a.year - b.year);

    // Chart-friendly arrays for the monthly view.
    const labels = schedule.rows.map((r) => r.monthLabel ?? `M${r.month}`);
    const interest = schedule.rows.map((r) => r.interestComponent);
    const principal = schedule.rows.map((r) => r.principalComponent);
    const balance = schedule.rows.map((r) => r.closingBalance);

    logger.info("calculateMonthlyBreakdown", {
      loanId,
      months: schedule.rows.length,
      years: yearly.length,
    });

    return {
      computed,
      summary: schedule.summary,
      monthly: {
        labels,
        interest,
        principal,
        balance,
      },
      yearly,
      rows: schedule.rows,
    };
  },
);

function parseStartDate(iso: string | undefined): Date | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
