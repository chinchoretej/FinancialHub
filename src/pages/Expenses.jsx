import { useState, useMemo } from 'react';
import { useCollection } from '../hooks/useFirestore';
import Card from '../components/Card';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import { HiOutlineReceiptPercent, HiPlus, HiTrash } from 'react-icons/hi2';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { format, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';

const CATEGORIES = ['Food', 'Transport', 'Utilities', 'Shopping', 'Health', 'Entertainment', 'Education', 'Rent', 'EMI', 'Other'];
const PAYMENT_MODES = ['Cash', 'UPI', 'Credit Card', 'Debit Card', 'Net Banking', 'Other'];
const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#64748b'];

const emptyExpense = { date: '', category: 'Food', amount: '', paymentMode: 'UPI', notes: '' };

export default function Expenses() {
  const { data: expenses, add, remove } = useCollection('expenses', 'date');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyExpense);
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));
  const fmt = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

  const handleSave = async () => {
    if (!form.date || !form.amount) return;
    await add(form);
    setForm(emptyExpense);
    setShowModal(false);
  };

  const filtered = useMemo(() => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const ms = startOfMonth(new Date(y, m - 1));
    const me = endOfMonth(new Date(y, m - 1));
    return expenses.filter(e => {
      try { return isWithinInterval(new Date(e.date), { start: ms, end: me }); }
      catch { return false; }
    });
  }, [expenses, selectedMonth]);

  const { total, categoryData, dailyData } = useMemo(() => {
    const total = filtered.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const catMap = {};
    const dayMap = {};
    filtered.forEach(e => {
      const cat = e.category || 'Other';
      catMap[cat] = (catMap[cat] || 0) + (Number(e.amount) || 0);
      const day = e.date?.slice(8, 10);
      if (day) dayMap[day] = (dayMap[day] || 0) + (Number(e.amount) || 0);
    });
    return {
      total,
      categoryData: Object.entries(catMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      dailyData: Object.entries(dayMap).map(([day, amount]) => ({ day, amount })).sort((a, b) => a.day.localeCompare(b.day)),
    };
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Expenses</h2>
        <button
          onClick={() => { setForm({ ...emptyExpense, date: format(new Date(), 'yyyy-MM-dd') }); setShowModal(true); }}
          className="flex items-center gap-1 px-3 py-2 bg-indigo-600 text-white text-sm rounded-xl hover:bg-indigo-700 transition-colors"
        >
          <HiPlus className="w-4 h-4" /> Add
        </button>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="month"
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <div className="text-sm text-gray-500">
          Total: <span className="font-semibold text-gray-900">{fmt(total)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <h3 className="text-sm font-semibold mb-3">Category Breakdown</h3>
          {categoryData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={65}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {categoryData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => fmt(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1 mt-2">
                {categoryData.map((c, i) => (
                  <div key={c.name} className="flex justify-between text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      {c.name}
                    </span>
                    <span className="font-medium">{fmt(c.value)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-400 text-center py-8">No data</p>
          )}
        </Card>

        <Card>
          <h3 className="text-sm font-semibold mb-3">Daily Spending</h3>
          {dailyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => fmt(v)} />
                <Bar dataKey="amount" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-gray-400 text-center py-8">No data</p>
          )}
        </Card>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={HiOutlineReceiptPercent} message="No expenses for this month" />
      ) : (
        <div className="space-y-2">
          {filtered.map(e => (
            <Card key={e.id} className="!p-3">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full">{e.category}</span>
                    <span className="text-xs text-gray-400">{e.paymentMode}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-sm font-semibold">{fmt(e.amount)}</span>
                    <span className="text-xs text-gray-400">{e.date}</span>
                  </div>
                  {e.notes && <p className="text-xs text-gray-500 mt-0.5 truncate">{e.notes}</p>}
                </div>
                <button onClick={() => remove(e.id)} className="p-1.5 hover:bg-gray-100 rounded-lg ml-2 shrink-0">
                  <HiTrash className="w-4 h-4 text-red-400" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add Expense">
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Date</label>
            <input type="date" value={form.date} onChange={e => set('date', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Category</label>
            <select value={form.category} onChange={e => set('category', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Amount</label>
            <input type="number" value={form.amount} onChange={e => set('amount', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Payment Mode</label>
            <select value={form.paymentMode} onChange={e => set('paymentMode', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Notes</label>
            <input type="text" value={form.notes} onChange={e => set('notes', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <button onClick={handleSave} className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors">
            Save Expense
          </button>
        </div>
      </Modal>
    </div>
  );
}
