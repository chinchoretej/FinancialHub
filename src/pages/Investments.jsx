import { useState, useMemo } from 'react';
import { useCollection } from '../hooks/useFirestore';
import Card from '../components/Card';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { HiOutlineChartBarSquare, HiPlus, HiTrash, HiPencil } from 'react-icons/hi2';
import { format } from 'date-fns';

const INVESTMENT_TYPES = ['Mutual Fund SIP', 'RD', 'FD', 'PPF', 'NPS', 'Bonds', 'Shares'];
const emptyInvestment = { name: '', type: 'Mutual Fund SIP', amount: '', dayOfMonth: '' };

export default function Investments() {
  const { data: investments, add, update, remove } = useCollection('investments', 'createdAt');
  const { add: addExpense, remove: removeExpense } = useCollection('expenses', 'date');
  const { data: investmentPayments, add: addPayment, remove: removePayment } = useCollection('investmentPayments', 'createdAt');

  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyInvestment);
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [payInvestment, setPayInvestment] = useState(null);
  const [confirmUnpay, setConfirmUnpay] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));
  const fmt = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

  const openAdd = () => {
    setForm(emptyInvestment);
    setEditId(null);
    setShowModal(true);
  };

  const openEdit = (inv) => {
    setForm({ name: inv.name, type: inv.type, amount: inv.amount, dayOfMonth: inv.dayOfMonth });
    setEditId(inv.id);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.amount) return;
    if (editId) {
      await update(editId, { name: form.name, amount: form.amount, dayOfMonth: form.dayOfMonth });
    } else {
      await add(form);
    }
    setForm(emptyInvestment);
    setEditId(null);
    setShowModal(false);
  };

  const paidMap = useMemo(() => {
    const map = {};
    investmentPayments.forEach(p => {
      map[`${p.investmentId}_${p.month}`] = p;
    });
    return map;
  }, [investmentPayments]);

  const isPaid = (invId) => !!paidMap[`${invId}_${selectedMonth}`];

  const handleTogglePaid = (inv) => {
    const key = `${inv.id}_${selectedMonth}`;
    const payment = paidMap[key];
    if (payment) {
      setConfirmUnpay({ inv, paymentId: payment.id, expenseId: payment.expenseId });
    } else {
      setPayInvestment(inv);
    }
  };

  const handleConfirmPay = async () => {
    if (!payInvestment) return;
    const today = format(new Date(), 'yyyy-MM-dd');

    const expenseRef = await addExpense({
      date: today,
      category: 'Investment',
      amount: payInvestment.amount,
      paymentMode: 'UPI',
      notes: `${payInvestment.name} (${payInvestment.type})`,
    });

    await addPayment({
      investmentId: payInvestment.id,
      month: selectedMonth,
      paidDate: today,
      amount: payInvestment.amount,
      expenseId: expenseRef.id,
    });

    setPayInvestment(null);
  };

  const confirmReverse = async () => {
    if (!confirmUnpay) return;
    if (confirmUnpay.expenseId) {
      await removeExpense(confirmUnpay.expenseId);
    }
    await removePayment(confirmUnpay.paymentId);
    setConfirmUnpay(null);
  };

  const paidCount = useMemo(() => investments.filter(i => isPaid(i.id)).length, [investments, paidMap, selectedMonth]);
  const totalMonthly = useMemo(() => investments.reduce((s, i) => s + (Number(i.amount) || 0), 0), [investments]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold dark:text-white">Investments</h2>
        <button onClick={openAdd} className="flex items-center gap-1 px-3 py-2 bg-indigo-600 text-white text-sm rounded-xl hover:bg-indigo-700 transition-colors">
          <HiPlus className="w-4 h-4" /> Add
        </button>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="month"
          value={selectedMonth}
          onChange={e => setSelectedMonth(e.target.value)}
          className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
        />
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {paidCount}/{investments.length} invested &middot; {fmt(totalMonthly)}/mo
        </div>
      </div>

      {investments.length === 0 ? (
        <EmptyState icon={HiOutlineChartBarSquare} message="No investments added yet" />
      ) : (
        <div className="space-y-2">
          {investments.map(inv => {
            const paid = isPaid(inv.id);
            return (
              <Card key={inv.id} className={`!p-3 ${paid ? 'opacity-60' : ''}`}>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleTogglePaid(inv)}
                    className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                      paid
                        ? 'border-green-500 bg-green-500 text-white'
                        : 'border-gray-300 dark:border-gray-500 hover:border-indigo-400'
                    }`}
                    title={paid ? 'Mark as not invested' : 'Mark as invested'}
                  >
                    {paid && <span className="text-xs font-bold">✓</span>}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${paid ? 'line-through text-gray-400' : 'dark:text-white'}`}>{inv.name}</span>
                      <span className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-600 dark:bg-emerald-900 dark:text-emerald-300 rounded-full">{inv.type}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-sm font-semibold dark:text-gray-200">{fmt(inv.amount)}</span>
                      {inv.dayOfMonth && (
                        <span className="text-xs text-gray-400">Debit day: {inv.dayOfMonth}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-0.5 shrink-0">
                    <button onClick={() => openEdit(inv)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                      <HiPencil className="w-4 h-4 text-gray-400" />
                    </button>
                    <button onClick={() => setConfirmDelete(inv)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                      <HiTrash className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add/Edit Investment modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editId ? 'Edit Investment' : 'Add Investment'}>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">Name</label>
            <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. HDFC Mid Cap SIP"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white" />
          </div>
          {!editId && (
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">Type</label>
              <select value={form.type} onChange={e => set('type', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white">
                {INVESTMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">Monthly Amount</label>
            <input type="number" value={form.amount} onChange={e => set('amount', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">Debit Day of Month (optional)</label>
            <input type="number" min="1" max="31" value={form.dayOfMonth} onChange={e => set('dayOfMonth', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white" />
          </div>
          <button onClick={handleSave} className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors">
            {editId ? 'Update' : 'Save Investment'}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Investment?"
        message={`Are you sure you want to delete "${confirmDelete?.name}"? This cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        danger
        onConfirm={async () => { await remove(confirmDelete.id); setConfirmDelete(null); }}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* Confirm invest for this month */}
      <ConfirmDialog
        open={!!payInvestment}
        title="Mark as Invested"
        message={`Confirm ${payInvestment?.name} (${fmt(payInvestment?.amount)}) invested for this month? This will also be added as an expense.`}
        confirmText="Yes, Invested"
        cancelText="Cancel"
        onConfirm={handleConfirmPay}
        onCancel={() => setPayInvestment(null)}
      />

      {/* Confirm reverse */}
      <ConfirmDialog
        open={!!confirmUnpay}
        title="Reverse Investment?"
        message={`This will reverse "${confirmUnpay?.inv?.name}" for this month and remove the linked expense.`}
        confirmText="Yes, Reverse"
        cancelText="Cancel"
        onConfirm={confirmReverse}
        onCancel={() => setConfirmUnpay(null)}
      />
    </div>
  );
}
