import { useMemo } from 'react';
import { useCollection } from '../hooks/useFirestore';
import { useUserProfile } from '../hooks/useUserProfile';
import Card from '../components/Card';
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { format, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';

const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6'];

export default function Dashboard() {
  const { data: loans } = useCollection('loans', 'createdAt');
  const { data: demands } = useCollection('demands', 'createdAt');
  const { data: payments } = useCollection('payments', 'createdAt');
  const { data: expenses } = useCollection('expenses', 'date');
  const { data: documents } = useCollection('documents', 'createdAt');
  const { profile } = useUserProfile();

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
        const d = new Date(e.date);
        return isWithinInterval(d, { start: monthStart, end: monthEnd });
      } catch { return false; }
    });
    const monthlyExpenseTotal = monthlyExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

    const profileSalary = Number(profile?.monthlySalary) || 0;
    const salaryDocs = documents.filter(d => d.salaryAmount);
    const docSalary = salaryDocs.length > 0 ? Number(salaryDocs[0].salaryAmount) || 0 : 0;
    const latestSalary = profileSalary || docSalary;

    const categoryMap = {};
    monthlyExpenses.forEach(e => {
      const cat = e.category || 'Other';
      categoryMap[cat] = (categoryMap[cat] || 0) + (Number(e.amount) || 0);
    });
    const categoryData = Object.entries(categoryMap).map(([name, value]) => ({ name, value }));

    const monthlyTrend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ms = startOfMonth(d);
      const me = endOfMonth(d);
      const total = expenses
        .filter(e => {
          try { return isWithinInterval(new Date(e.date), { start: ms, end: me }); }
          catch { return false; }
        })
        .reduce((s, e) => s + (Number(e.amount) || 0), 0);
      monthlyTrend.push({ month: format(ms, 'MMM'), amount: total });
    }

    const budgetUsedPct = latestSalary > 0 ? ((monthlyExpenseTotal / latestSalary) * 100) : 0;

    return {
      totalSanctioned, totalDisbursed, totalRemaining,
      totalDemanded, totalPaidOnDemands,
      pendingDemands: pendingDemands.length,
      monthlyExpenseTotal, latestSalary,
      savings: latestSalary - monthlyExpenseTotal,
      budgetUsedPct,
      categoryData, monthlyTrend,
    };
  }, [loans, demands, payments, expenses, documents, profile]);

  const fmt = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold dark:text-white">Dashboard</h2>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Loan Outstanding" value={fmt(stats.totalRemaining)} color="text-red-600" />
        <StatCard label="Total Paid" value={fmt(stats.totalPaidOnDemands)} color="text-green-600" />
        <StatCard label="Pending Demands" value={stats.pendingDemands} color="text-amber-600" />
        <StatCard label="Monthly Expenses" value={fmt(stats.monthlyExpenseTotal)} color="text-indigo-600" />
        <StatCard label="Monthly Salary" value={fmt(stats.latestSalary)} color="text-blue-600" />
        <StatCard label="Savings" value={fmt(stats.savings)} color={stats.savings >= 0 ? 'text-green-600' : 'text-red-600'} />
      </div>

      {stats.latestSalary > 0 && (
        <Card>
          <h3 className="text-sm font-semibold mb-2 dark:text-white">Budget Usage</h3>
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
            <span>Spent: {fmt(stats.monthlyExpenseTotal)}</span>
            <span>Salary: {fmt(stats.latestSalary)}</span>
          </div>
          <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${stats.budgetUsedPct > 90 ? 'bg-red-500' : stats.budgetUsedPct > 70 ? 'bg-amber-500' : 'bg-green-500'}`}
              style={{ width: `${Math.min(stats.budgetUsedPct, 100)}%` }}
            />
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            {stats.budgetUsedPct.toFixed(1)}% of salary spent
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <h3 className="text-sm font-semibold mb-3 dark:text-white">Expense Breakdown</h3>
          {stats.categoryData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={stats.categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {stats.categoryData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => fmt(v)} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-gray-400 text-center py-8">No expenses this month</p>
          )}
        </Card>

        <Card>
          <h3 className="text-sm font-semibold mb-3 dark:text-white">Monthly Trend</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={stats.monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v) => fmt(v)} />
              <Bar dataKey="amount" fill="#6366f1" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

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
