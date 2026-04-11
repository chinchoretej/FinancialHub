import { useState, useMemo } from 'react';
import { useCollection } from '../hooks/useFirestore';
import Card from '../components/Card';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import { HiOutlineReceiptPercent, HiPlus, HiTrash, HiMagnifyingGlass, HiXMark } from 'react-icons/hi2';
import { format, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';

const CATEGORIES = ['Food', 'Transport', 'Utilities', 'Shopping', 'Health', 'Entertainment', 'Education', 'Rent', 'EMI', 'Bills', 'Other'];
const PAYMENT_MODES = ['Cash', 'UPI', 'Credit Card', 'Debit Card', 'Net Banking', 'Other'];

const emptyExpense = { date: '', category: 'Food', amount: '', paymentMode: 'UPI', notes: '' };

export default function Expenses() {
  const { data: expenses, add, remove } = useCollection('expenses', 'date');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyExpense);
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));

  const [showSearch, setShowSearch] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterMinAmount, setFilterMinAmount] = useState('');
  const [filterMaxAmount, setFilterMaxAmount] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  const hasActiveFilters = searchKeyword || filterCategory || filterMinAmount || filterMaxAmount || filterDateFrom || filterDateTo;

  const clearFilters = () => {
    setSearchKeyword('');
    setFilterCategory('');
    setFilterMinAmount('');
    setFilterMaxAmount('');
    setFilterDateFrom('');
    setFilterDateTo('');
  };

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));
  const fmt = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

  const handleSave = async () => {
    if (!form.date || !form.amount) return;
    await add(form);
    setForm(emptyExpense);
    setShowModal(false);
  };

  const monthFiltered = useMemo(() => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const ms = startOfMonth(new Date(y, m - 1));
    const me = endOfMonth(new Date(y, m - 1));
    return expenses.filter(e => {
      try { return isWithinInterval(new Date(e.date), { start: ms, end: me }); }
      catch { return false; }
    });
  }, [expenses, selectedMonth]);

  const filtered = useMemo(() => {
    let result = monthFiltered;
    if (searchKeyword) {
      const kw = searchKeyword.toLowerCase();
      result = result.filter(e =>
        (e.notes || '').toLowerCase().includes(kw) ||
        (e.category || '').toLowerCase().includes(kw) ||
        (e.paymentMode || '').toLowerCase().includes(kw) ||
        String(e.amount).includes(kw)
      );
    }
    if (filterCategory) {
      result = result.filter(e => e.category === filterCategory);
    }
    if (filterMinAmount) {
      result = result.filter(e => Number(e.amount) >= Number(filterMinAmount));
    }
    if (filterMaxAmount) {
      result = result.filter(e => Number(e.amount) <= Number(filterMaxAmount));
    }
    if (filterDateFrom) {
      result = result.filter(e => e.date >= filterDateFrom);
    }
    if (filterDateTo) {
      result = result.filter(e => e.date <= filterDateTo);
    }
    return result;
  }, [monthFiltered, searchKeyword, filterCategory, filterMinAmount, filterMaxAmount, filterDateFrom, filterDateTo]);

  const total = useMemo(() => filtered.reduce((s, e) => s + (Number(e.amount) || 0), 0), [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold dark:text-white">Expenses</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSearch(s => !s)}
            className={`p-2 rounded-xl text-sm transition-colors ${showSearch || hasActiveFilters ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300' : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'}`}
            title="Search & Filter"
          >
            <HiMagnifyingGlass className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setForm({ ...emptyExpense, date: format(new Date(), 'yyyy-MM-dd') }); setShowModal(true); }}
            className="flex items-center gap-1 px-3 py-2 bg-indigo-600 text-white text-sm rounded-xl hover:bg-indigo-700 transition-colors"
          >
            <HiPlus className="w-4 h-4" /> Add
          </button>
        </div>
      </div>

      {showSearch && (
        <Card>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <HiMagnifyingGlass className="w-4 h-4 text-gray-400 shrink-0" />
              <input
                type="text"
                value={searchKeyword}
                onChange={e => setSearchKeyword(e.target.value)}
                placeholder="Search by keyword, notes, category..."
                className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
              />
              {hasActiveFilters && (
                <button onClick={clearFilters} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400" title="Clear all filters">
                  <HiXMark className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Category</label>
                <select
                  value={filterCategory}
                  onChange={e => setFilterCategory(e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
                >
                  <option value="">All</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Amount Range</label>
                <div className="flex gap-1">
                  <input type="number" placeholder="Min" value={filterMinAmount} onChange={e => setFilterMinAmount(e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white" />
                  <input type="number" placeholder="Max" value={filterMaxAmount} onChange={e => setFilterMaxAmount(e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">From Date</label>
                <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">To Date</label>
                <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white" />
              </div>
            </div>
            {hasActiveFilters && (
              <p className="text-xs text-indigo-600 dark:text-indigo-400">{filtered.length} result{filtered.length !== 1 ? 's' : ''} found</p>
            )}
          </div>
        </Card>
      )}

      <div className="flex items-center gap-3">
        <input
          type="month"
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
        />
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Total: <span className="font-semibold text-gray-900 dark:text-white">{fmt(total)}</span>
        </div>
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
