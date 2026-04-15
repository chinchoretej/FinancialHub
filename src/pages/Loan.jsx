import { useState } from 'react';
import { useCollection } from '../hooks/useFirestore';
import Card from '../components/Card';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { HiOutlineBanknotes, HiPlus, HiTrash, HiPencil } from 'react-icons/hi2';

const DEMAND_STATUSES = ['Pending', 'Paid', 'Partial'];

const emptyLoan = {
  loanAccountNumber: '', bankName: '', sanctionAmount: '', interestRate: '',
  tenure: '', emiAmount: '', preEmiAmount: '', totalDisbursed: '', remainingAmount: '',
};
const emptyDemand = {
  demandDate: '', constructionStage: '', demandAmount: '', gstPercent: '5', gstAmount: '',
  dueDate: '', status: 'Pending',
};
const emptyPayment = {
  demandId: '', paymentDate: '', paidBy: 'Self', amountPaid: '', gstPaid: '', transactionRef: '',
};

export default function Loan() {
  const { data: loans, add: addLoan, update: updateLoan, remove: removeLoan } = useCollection('loans', 'createdAt');
  const { data: demands, add: addDemand, update: updateDemand, remove: removeDemand } = useCollection('demands', 'createdAt');
  const { data: payments, add: addPayment, update: updatePayment, remove: removePayment } = useCollection('payments', 'createdAt');

  const [tab, setTab] = useState('loans');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [editId, setEditId] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const openAdd = (type, defaults) => {
    setForm(defaults);
    setEditId(null);
    setModal(type);
  };
  const openEdit = (type, item) => {
    setForm({ ...item });
    setEditId(item.id);
    setModal(type);
  };

  const handleSave = async () => {
    if (modal === 'loan') {
      editId ? await updateLoan(editId, form) : await addLoan(form);
    } else if (modal === 'demand') {
      const totalDemand = (Number(form.demandAmount) || 0) + (Number(form.gstAmount) || 0);
      const data = { ...form, totalDemand };
      editId ? await updateDemand(editId, data) : await addDemand(data);
    } else if (modal === 'payment') {
      const amountPaid = Number(form.amountPaid) || 0;
      const gstPaid = Number(form.gstPaid) || 0;
      const totalPaid = amountPaid + gstPaid;
      const demand = demands.find(d => d.id === form.demandId);
      const demandTotal = demand ? (Number(demand.demandAmount) || 0) + (Number(demand.gstAmount) || 0) : 0;
      const existingPayments = payments
        .filter(p => p.demandId === form.demandId && p.id !== editId)
        .reduce((s, p) => s + (Number(p.amountPaid) || 0) + (Number(p.gstPaid) || 0), 0);
      const outstandingAmount = demandTotal - existingPayments - totalPaid;

      let delayDays = null;
      if (demand?.dueDate && form.paymentDate) {
        const due = new Date(demand.dueDate);
        const paid = new Date(form.paymentDate);
        delayDays = Math.round((paid - due) / (1000 * 60 * 60 * 24));
      }

      const paymentData = { ...form, totalPaid, outstandingAmount, delayDays };
      editId ? await updatePayment(editId, paymentData) : await addPayment(paymentData);
    }
    setModal(null);
  };

  const confirmDelete = (type, id, label) => setDeleteConfirm({ type, id, label });
  const handleDelete = async () => {
    if (!deleteConfirm) return;
    const { type, id } = deleteConfirm;
    if (type === 'loan') await removeLoan(id);
    else if (type === 'demand') await removeDemand(id);
    else if (type === 'payment') await removePayment(id);
    setDeleteConfirm(null);
  };

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));
  const fmt = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

  const subTabs = [
    { key: 'loans', label: 'Loans' },
    { key: 'demands', label: 'Demands' },
    { key: 'payments', label: 'Payments' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Home Loan</h2>
        <button
          onClick={() => {
            if (tab === 'loans') openAdd('loan', emptyLoan);
            else if (tab === 'demands') openAdd('demand', emptyDemand);
            else openAdd('payment', emptyPayment);
          }}
          className="flex items-center gap-1 px-3 py-2 bg-indigo-600 text-white text-sm rounded-xl hover:bg-indigo-700 transition-colors"
        >
          <HiPlus className="w-4 h-4" /> Add
        </button>
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        {subTabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2 text-sm rounded-lg transition-colors ${
              tab === t.key ? 'bg-white font-medium shadow-sm' : 'text-gray-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'loans' && (
        loans.length === 0 ? (
          <EmptyState icon={HiOutlineBanknotes} message="No loans added yet" />
        ) : (
          <div className="space-y-3">
            {loans.map(loan => (
              <Card key={loan.id}>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold">{loan.bankName}</p>
                    <p className="text-xs text-gray-500">A/C: {loan.loanAccountNumber}</p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit('loan', loan)} className="p-1.5 hover:bg-gray-100 rounded-lg"><HiPencil className="w-4 h-4 text-gray-400" /></button>
                    <button onClick={() => confirmDelete('loan', loan.id, loan.bankName)} className="p-1.5 hover:bg-gray-100 rounded-lg"><HiTrash className="w-4 h-4 text-red-400" /></button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
                  <div><span className="text-gray-500">Sanctioned:</span> {fmt(loan.sanctionAmount)}</div>
                  <div><span className="text-gray-500">Rate:</span> {loan.interestRate}%</div>
                  <div><span className="text-gray-500">EMI:</span> {fmt(loan.emiAmount)}</div>
                  <div><span className="text-gray-500">Tenure:</span> {loan.tenure} months</div>
                  <div><span className="text-gray-500">Disbursed:</span> {fmt(loan.totalDisbursed)}</div>
                  <div><span className="text-gray-500">Remaining:</span> {fmt(loan.remainingAmount)}</div>
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      {tab === 'demands' && (
        demands.length === 0 ? (
          <EmptyState icon={HiOutlineBanknotes} message="No builder demands yet" />
        ) : (
          <div className="space-y-3">
            {demands.map(d => (
              <Card key={d.id}>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold">{d.constructionStage}</p>
                    <p className="text-xs text-gray-500">{d.demandDate}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      d.status === 'Paid' ? 'bg-green-100 text-green-700' :
                      d.status === 'Partial' ? 'bg-amber-100 text-amber-700' :
                      'bg-red-100 text-red-700'
                    }`}>{d.status}</span>
                    <button onClick={() => openEdit('demand', d)} className="p-1.5 hover:bg-gray-100 rounded-lg"><HiPencil className="w-4 h-4 text-gray-400" /></button>
                    <button onClick={() => confirmDelete('demand', d.id, d.constructionStage)} className="p-1.5 hover:bg-gray-100 rounded-lg"><HiTrash className="w-4 h-4 text-red-400" /></button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
                  <div><span className="text-gray-500">Amount:</span> {fmt(d.demandAmount)}</div>
                  <div><span className="text-gray-500">GST:</span> {fmt(d.gstAmount)}</div>
                  <div><span className="text-gray-500">Total:</span> {fmt(d.totalDemand)}</div>
                  <div><span className="text-gray-500">Due:</span> {d.dueDate}</div>
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      {tab === 'payments' && (
        payments.length === 0 ? (
          <EmptyState icon={HiOutlineBanknotes} message="No payments recorded" />
        ) : (
          <div className="space-y-3">
            {payments.map(p => {
              const demand = demands.find(d => d.id === p.demandId);
              return (
                <Card key={p.id}>
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold">{demand?.constructionStage || 'Unknown Demand'}</p>
                      <p className="text-xs text-gray-500">{p.paymentDate} &middot; {p.paidBy}</p>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => openEdit('payment', p)} className="p-1.5 hover:bg-gray-100 rounded-lg"><HiPencil className="w-4 h-4 text-gray-400" /></button>
                      <button onClick={() => confirmDelete('payment', p.id, demand?.constructionStage || 'Payment')} className="p-1.5 hover:bg-gray-100 rounded-lg"><HiTrash className="w-4 h-4 text-red-400" /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
                    <div><span className="text-gray-500">Paid:</span> {fmt(p.totalPaid)}</div>
                    <div><span className="text-gray-500">Outstanding:</span> {fmt(p.outstandingAmount)}</div>
                    <div><span className="text-gray-500">Ref:</span> {p.transactionRef || '-'}</div>
                    {p.delayDays != null && (
                      <div><span className="text-gray-500">Delay:</span> {p.delayDays > 0 ? `${p.delayDays} days late` : 'On time'}</div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )
      )}

      {/* Loan Modal */}
      <Modal open={modal === 'loan'} onClose={() => setModal(null)} title={editId ? 'Edit Loan' : 'Add Loan'}>
        <div className="space-y-3">
          {[
            ['loanAccountNumber', 'Account Number', 'text'],
            ['bankName', 'Bank Name', 'text'],
            ['sanctionAmount', 'Sanction Amount', 'number'],
            ['interestRate', 'Interest Rate (%)', 'number'],
            ['tenure', 'Tenure (months)', 'number'],
            ['emiAmount', 'EMI Amount', 'number'],
            ['preEmiAmount', 'Pre-EMI Amount', 'number'],
            ['totalDisbursed', 'Total Disbursed', 'number'],
            ['remainingAmount', 'Remaining Amount', 'number'],
          ].map(([key, label, type]) => (
            <div key={key}>
              <label className="block text-sm text-gray-600 mb-1">{label}</label>
              <input type={type} value={form[key] || ''} onChange={e => set(key, e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          ))}
          <button onClick={handleSave} className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors">
            {editId ? 'Update' : 'Save'}
          </button>
        </div>
      </Modal>

      {/* Demand Modal */}
      <Modal open={modal === 'demand'} onClose={() => setModal(null)} title={editId ? 'Edit Demand' : 'Add Demand'}>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Demand Date</label>
            <input type="date" value={form.demandDate || ''} onChange={e => set('demandDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Construction Stage</label>
            <input type="text" value={form.constructionStage || ''} onChange={e => set('constructionStage', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Demand Amount</label>
            <input type="number" value={form.demandAmount || ''} onChange={e => {
              const amt = e.target.value;
              const gst = amt ? ((Number(amt) * (Number(form.gstPercent) || 0)) / 100).toFixed(2) : '';
              setForm(prev => ({ ...prev, demandAmount: amt, gstAmount: gst }));
            }}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">GST %</label>
            <div className="flex gap-2">
              <input type="number" value={form.gstPercent ?? '5'} onChange={e => {
                const pct = e.target.value;
                const gst = form.demandAmount ? ((Number(form.demandAmount) * (Number(pct) || 0)) / 100).toFixed(2) : '';
                setForm(prev => ({ ...prev, gstPercent: pct, gstAmount: gst }));
              }}
                className="w-24 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <input type="number" value={form.gstAmount || ''} onChange={e => set('gstAmount', e.target.value)}
                placeholder="GST amount"
                className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div className="bg-gray-50 p-3 rounded-xl text-sm">
            <span className="text-gray-500">Total Demand:</span>{' '}
            <span className="font-medium">{fmt((Number(form.demandAmount) || 0) + (Number(form.gstAmount) || 0))}</span>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Due Date</label>
            <input type="date" value={form.dueDate || ''} onChange={e => set('dueDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Status</label>
            <select value={form.status || 'Pending'} onChange={e => set('status', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {DEMAND_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <button onClick={handleSave} className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors">
            {editId ? 'Update' : 'Save'}
          </button>
        </div>
      </Modal>

      {/* Payment Modal */}
      <Modal open={modal === 'payment'} onClose={() => setModal(null)} title={editId ? 'Edit Payment' : 'Add Payment'}>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Demand</label>
            <select value={form.demandId || ''} onChange={e => set('demandId', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">Select demand...</option>
              {demands.map(d => (
                <option key={d.id} value={d.id}>{d.constructionStage} - {fmt(d.totalDemand)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Payment Date</label>
            <input type="date" value={form.paymentDate || ''} onChange={e => set('paymentDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Paid By</label>
            <select value={form.paidBy || 'Self'} onChange={e => set('paidBy', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="Self">Self</option>
              <option value="Bank">Bank</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Amount Paid</label>
            <input type="number" value={form.amountPaid || ''} onChange={e => set('amountPaid', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">GST Paid</label>
            <input type="number" value={form.gstPaid || ''} onChange={e => set('gstPaid', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div className="bg-gray-50 p-3 rounded-xl text-sm">
            <span className="text-gray-500">Total Paid:</span>{' '}
            <span className="font-medium">{fmt((Number(form.amountPaid) || 0) + (Number(form.gstPaid) || 0))}</span>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Transaction Ref</label>
            <input type="text" value={form.transactionRef || ''} onChange={e => set('transactionRef', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <button onClick={handleSave} className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors">
            {editId ? 'Update Payment' : 'Save Payment'}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteConfirm}
        title="Confirm Delete"
        message={`Are you sure you want to delete "${deleteConfirm?.label}"? This action cannot be undone.`}
        confirmText="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirm(null)}
        danger
      />
    </div>
  );
}
