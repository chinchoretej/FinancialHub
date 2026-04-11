import { useState, useMemo } from 'react';
import { useCollection } from '../hooks/useFirestore';
import { useUserProfile } from '../hooks/useUserProfile';
import Card from '../components/Card';
import { format, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';

export default function Dashboard() {
  const { data: loans } = useCollection('loans', 'createdAt');
  const { data: demands } = useCollection('demands', 'createdAt');
  const { data: payments } = useCollection('payments', 'createdAt');
  const { data: expenses } = useCollection('expenses', 'date');
  const { data: documents } = useCollection('documents', 'createdAt');
  const { profile } = useUserProfile();

  const [breakdownMonth, setBreakdownMonth] = useState(format(new Date(), 'yyyy-MM'));

  const stats = useMemo(() => {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    const totalSanctioned = loans.reduce((s, l) => s + (Number(l.sanctionAmount) || 0), 0);
    const totalDisbursed = loans.reduce((s, l) => s + (Number(l.totalDisbursed) || 0), 0);
    const totalRemaining = loans.reduce((s, l) => s + (Number(l.remainingAmount) || 0), 0);

    const totalDemanded = demands.reduce((s, d) => {
      const amt = (Number(d.demandAmount) || 0) + (Number(d.gstAmount) || 0);
      return s + amt;
    }, 0);
    const totalPaidOnDemands = payments.reduce((s, p) => {
      return s + (Number(p.amountPaid) || 0) + (Number(p.gstPaid) || 0);
    }, 0);

    const pendingDemands = demands.filter(d => d.status === 'Pending');

    const monthlyExpenses = expenses.filter(e => {
      try {
        return isWithinInterval(new Date(e.date), { start: monthStart, end: monthEnd });
      } catch { return false; }
    });
    const monthlyExpenseTotal = monthlyExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

    const profileSalary = Number(profile?.monthlySalary) || 0;
    const otherIncome = Number(profile?.otherIncome) || 0;
    const salaryDocs = documents.filter(d => d.salaryAmount);
    const docSalary = salaryDocs.length > 0 ? Number(salaryDocs[0].salaryAmount) || 0 : 0;
    const latestSalary = profileSalary || docSalary;
    const totalIncome = latestSalary + otherIncome;

    const budgetUsedPct = totalIncome > 0 ? ((monthlyExpenseTotal / totalIncome) * 100) : 0;

    return {
      totalSanctioned, totalDisbursed, totalRemaining,
      totalDemanded, totalPaidOnDemands,
      pendingDemands: pendingDemands.length,
      monthlyExpenseTotal, latestSalary, otherIncome, totalIncome,
      savings: totalIncome - monthlyExpenseTotal,
      budgetUsedPct,
    };
  }, [loans, demands, payments, expenses, documents, profile]);

  const { categoryData, breakdownTotal } = useMemo(() => {
    const [y, m] = breakdownMonth.split('-').map(Number);
    const ms = startOfMonth(new Date(y, m - 1));
    const me = endOfMonth(new Date(y, m - 1));
    const filtered = expenses.filter(e => {
      try { return isWithinInterval(new Date(e.date), { start: ms, end: me }); }
      catch { return false; }
    });
    const catMap = {};
    filtered.forEach(e => {
      const cat = e.category || 'Other';
      catMap[cat] = (catMap[cat] || 0) + (Number(e.amount) || 0);
    });
    const categoryData = Object.entries(catMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    const breakdownTotal = filtered.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    return { categoryData, breakdownTotal };
  }, [expenses, breakdownMonth]);

  const fmt = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold dark:text-white">Dashboard</h2>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Loan Outstanding" value={fmt(stats.totalRemaining)} color="text-red-600" />
        <StatCard label="Total Paid" value={fmt(stats.totalPaidOnDemands)} color="text-green-600" />
        <StatCard label="Pending Demands" value={stats.pendingDemands} color="text-amber-600" />
        <StatCard label="Monthly Expenses" value={fmt(stats.monthlyExpenseTotal)} color="text-indigo-600" />
        <StatCard label="Total Income" value={fmt(stats.totalIncome)} color="text-blue-600" />
        <StatCard label="Savings" value={fmt(stats.savings)} color={stats.savings >= 0 ? 'text-green-600' : 'text-red-600'} />
      </div>

      {stats.totalIncome > 0 && (
        <Card>
          <h3 className="text-sm font-semibold mb-2 dark:text-white">Budget Usage</h3>
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
            <span>Spent: {fmt(stats.monthlyExpenseTotal)}</span>
            <span>Income: {fmt(stats.totalIncome)}{stats.otherIncome > 0 && ` (Salary ${fmt(stats.latestSalary)} + Other ${fmt(stats.otherIncome)})`}</span>
          </div>
          <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${stats.budgetUsedPct > 90 ? 'bg-red-500' : stats.budgetUsedPct > 70 ? 'bg-amber-500' : 'bg-green-500'}`}
              style={{ width: `${Math.min(stats.budgetUsedPct, 100)}%` }}
            />
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            {stats.budgetUsedPct.toFixed(1)}% of income spent
          </p>
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold dark:text-white">Expense Breakdown</h3>
          <input
            type="month"
            value={breakdownMonth}
            onChange={e => setBreakdownMonth(e.target.value)}
            className="px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
          />
        </div>
        {categoryData.length > 0 ? (
          <div>
            <div className="space-y-2">
              {categoryData.map(c => (
                <div key={c.name} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700 dark:text-gray-300">{c.name}</span>
                  <div className="flex items-center gap-3">
                    <div className="w-24 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full"
                        style={{ width: `${breakdownTotal ? (c.value / breakdownTotal) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium text-gray-900 dark:text-white w-24 text-right">{fmt(c.value)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
              <span className="text-sm font-semibold dark:text-white">Total</span>
              <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{fmt(breakdownTotal)}</span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-400 text-center py-6">No expenses for this month</p>
        )}
      </Card>

      <Card>
        <h3 className="text-sm font-semibold mb-3 dark:text-white">Loan: Disbursed vs Demanded</h3>
        <div className="flex gap-4 text-sm">
          <div className="flex-1">
            <div className="text-gray-500 dark:text-gray-400 text-xs">Sanctioned</div>
            <div className="font-semibold dark:text-white">{fmt(stats.totalSanctioned)}</div>
          </div>
          <div className="flex-1">
            <div className="text-gray-500 dark:text-gray-400 text-xs">Disbursed</div>
            <div className="font-semibold dark:text-white">{fmt(stats.totalDisbursed)}</div>
          </div>
          <div className="flex-1">
            <div className="text-gray-500 dark:text-gray-400 text-xs">Demanded</div>
            <div className="font-semibold dark:text-white">{fmt(stats.totalDemanded)}</div>
          </div>
        </div>
        <div className="mt-3 h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden flex">
          <div
            className="bg-indigo-500 h-full"
            style={{ width: `${stats.totalSanctioned ? (stats.totalDisbursed / stats.totalSanctioned) * 100 : 0}%` }}
          />
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          {stats.totalSanctioned ? ((stats.totalDisbursed / stats.totalSanctioned) * 100).toFixed(1) : 0}% disbursed
        </p>
      </Card>
    </div>
  );
}

function StatCard({ label, value, color = 'text-gray-900' }) {
  return (
    <Card>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </Card>
  );
}
