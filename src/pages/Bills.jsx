import { useState, useMemo } from 'react';
import { useCollection } from '../hooks/useFirestore';
import Card from '../components/Card';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { HiOutlineBellAlert, HiPlus, HiTrash, HiCheckCircle, HiClock } from 'react-icons/hi2';
import { format, differenceInDays } from 'date-fns';

const emptyBill = { name: '', dueDay: '', category: 'Utility' };
const BILL_CATEGORIES = ['Utility', 'Rent', 'Insurance', 'Subscription', 'EMI', 'Credit Card', 'Other'];

export default function Bills() {
  const { data: bills, add, remove } = useCollection('bills', 'createdAt');
  const { data: billPayments, add: addPayment, remove: removePayment } = useCollection('billPayments', 'createdAt');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyBill);
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [confirmUnpay, setConfirmUnpay] = useState(null);

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    if (!form.name || !form.dueDay) return;
    await add(form);
    setForm(emptyBill);
    setShowModal(false);
  };

  const paidMap = useMemo(() => {
    const map = {};
    billPayments.forEach(p => {
      map[`${p.billId}_${p.month}`] = p;
    });
    return map;
  }, [billPayments]);

  const handleTogglePaid = async (bill) => {
    const key = `${bill.id}_${selectedMonth}`;
    const payment = paidMap[key];
    if (payment) {
      setConfirmUnpay({ bill, paymentId: payment.id });
    } else {
      await addPayment({
        billId: bill.id,
        month: selectedMonth,
        paidDate: format(new Date(), 'yyyy-MM-dd'),
      });
    }
  };

  const confirmReverse = async () => {
    if (confirmUnpay) {
      await removePayment(confirmUnpay.paymentId);
      setConfirmUnpay(null);
    }
  };

  const isPaid = (billId) => !!paidMap[`${billId}_${selectedMonth}`];

  const upcomingReminders = useMemo(() => {
    const today = new Date();
    return bills
      .filter(b => {
        if (isPaid(b.id)) return false;
        const [y, m] = selectedMonth.split('-').map(Number);
        const dueDate = new Date(y, m - 1, Number(b.dueDay));
        const daysUntil = differenceInDays(dueDate, today);
        return daysUntil >= -3 && daysUntil <= 7;
      })
      .map(b => {
        const [y, m] = selectedMonth.split('-').map(Number);
        const dueDate = new Date(y, m - 1, Number(b.dueDay));
        const daysUntil = differenceInDays(dueDate, today);
        return { ...b, dueDate, daysUntil };
      })
      .sort((a, b) => a.daysUntil - b.daysUntil);
  }, [bills, selectedMonth, paidMap]);

  const paidCount = useMemo(() => bills.filter(b => isPaid(b.id)).length, [bills, paidMap, selectedMonth]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold dark:text-white">Bills</h2>
        <button
          onClick={() => { setForm(emptyBill); setShowModal(true); }}
          className="flex items-center gap-1 px-3 py-2 bg-indigo-600 text-white text-sm rounded-xl hover:bg-indigo-700 transition-colors"
        >
          <HiPlus className="w-4 h-4" /> Add Bill
        </button>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="month"
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
        />
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {paidCount}/{bills.length} paid
        </div>
      </div>

      {upcomingReminders.length > 0 && (
        <Card className="!bg-amber-50 !border-amber-200 dark:!bg-amber-900/30 dark:!border-amber-800">
          <div className="flex items-center gap-2 mb-2">
            <HiOutlineBellAlert className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">Upcoming / Overdue</h3>
          </div>
          <div className="space-y-1">
            {upcomingReminders.map(b => (
              <div key={b.id} className="flex justify-between text-xs">
                <span className="text-amber-700 dark:text-amber-300">{b.name}</span>
                <span className={`font-medium ${b.daysUntil < 0 ? 'text-red-600' : b.daysUntil <= 2 ? 'text-amber-600' : 'text-gray-600 dark:text-gray-300'}`}>
                  {b.daysUntil < 0 ? `${Math.abs(b.daysUntil)}d overdue` : b.daysUntil === 0 ? 'Due today' : `${b.daysUntil}d left`}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {bills.length === 0 ? (
        <EmptyState icon={HiOutlineBellAlert} message="No bills added yet" />
      ) : (
        <div className="space-y-2">
          {bills.map(b => {
            const paid = isPaid(b.id);
            const dayNum = Number(b.dueDay) || 1;
            const dueStr = `${selectedMonth}-${String(dayNum).padStart(2, '0')}`;
            return (
              <Card key={b.id} className={`!p-3 ${paid ? 'opacity-60' : ''}`}>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleTogglePaid(b)}
                    className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                      paid
                        ? 'border-green-500 bg-green-500 text-white'
                        : 'border-gray-300 dark:border-gray-500 hover:border-indigo-400'
                    }`}
                    title={paid ? 'Mark as unpaid' : 'Mark as paid'}
                  >
                    {paid && <HiCheckCircle className="w-4 h-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${paid ? 'line-through text-gray-400' : 'dark:text-white'}`}>{b.name}</span>
                      <span className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300 rounded-full">{b.category}</span>
                    </div>
                    <span className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                      <HiClock className="w-3 h-3" /> Due: {dueStr}
                    </span>
                  </div>
                  <button onClick={() => remove(b.id)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg shrink-0">
                    <HiTrash className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add Bill">
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">Bill Name</label>
            <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Electricity Bill"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">Category</label>
            <select value={form.category} onChange={e => set('category', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white">
              {BILL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">Due Day of Month (1-31)</label>
            <input type="number" min="1" max="31" value={form.dueDay} onChange={e => set('dueDay', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white" />
          </div>
          <button onClick={handleSave} className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors">
            Save Bill
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmUnpay}
        title="Mark as Unpaid?"
        message={`Are you sure you want to reverse the paid status for "${confirmUnpay?.bill?.name}"?`}
        confirmText="Yes, Unpay"
        cancelText="Cancel"
        onConfirm={confirmReverse}
        onCancel={() => setConfirmUnpay(null)}
      />
    </div>
  );
}
