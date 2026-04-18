import { useState, useMemo } from 'react';
import { useCollection } from '../hooks/useFirestore';
import Card from '../components/Card';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import {
  HiOutlineBanknotes, HiPlus, HiTrash, HiPencil,
  HiOutlineCurrencyRupee, HiOutlineDocumentText,
  HiOutlineArrowTrendingUp, HiOutlineClock,
  HiOutlineBuildingOffice2, HiOutlineCalculator,
  HiOutlineInformationCircle,
} from 'react-icons/hi2';

const PAYMENT_CATEGORIES = ['Agreement Value', 'Stamp Duty', 'Registration', 'GST', 'Legal Charges'];
const CATEGORY_COLORS = {
  'Agreement Value': { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400', hex: '#22c55e' },
  'Stamp Duty': { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400', hex: '#3b82f6' },
  'Registration': { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-400', hex: '#a855f7' },
  'GST': { bg: 'bg-cyan-100 dark:bg-cyan-900/30', text: 'text-cyan-700 dark:text-cyan-400', hex: '#06b6d4' },
  'Legal Charges': { bg: 'bg-pink-100 dark:bg-pink-900/30', text: 'text-pink-700 dark:text-pink-400', hex: '#ec4899' },
};
const CATEGORY_PARTICULARS = {
  'Agreement Value': '',
  'Stamp Duty': 'Stamp Duty',
  'Registration': 'Registration Charges',
  'GST': 'GST @ Actuals',
  'Legal Charges': 'Legal Charges',
};
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
  category: 'Agreement Value', particulars: '', demandId: '', paymentDate: '',
  paidBy: 'Self', amountPaid: '', gstPaid: '', transactionRef: '', status: 'Paid',
};
const emptyFlatCost = {
  agreementValue: '', stampDuty: '', gst: '', registrationCharges: '', legalCharges: '',
};

function DonutChart({ segments, total, fmt }) {
  const size = 160;
  const radius = 56;
  const strokeWidth = 24;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  let cumulative = 0;
  const arcs = segments.map(seg => {
    const pct = total > 0 ? seg.value / total : 0;
    const length = pct * circumference;
    const offset = cumulative;
    cumulative += length;
    return { ...seg, length, offset };
  });

  return (
    <div className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={center} cy={center} r={radius} fill="none" stroke="currentColor"
          className="text-gray-100 dark:text-gray-700" strokeWidth={strokeWidth} />
        {arcs.map((arc, i) => (
          <circle key={i} cx={center} cy={center} r={radius} fill="none"
            stroke={arc.color} strokeWidth={strokeWidth}
            strokeDasharray={`${arc.length} ${circumference - arc.length}`}
            strokeDashoffset={-arc.offset}
            transform={`rotate(-90 ${center} ${center})`} />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[10px] text-gray-500 dark:text-gray-400">Total</span>
        <span className="text-xs font-bold dark:text-white">{fmt(total)}</span>
      </div>
    </div>
  );
}

const getPaymentTotal = (p) => {
  if (p.totalPaid != null && p.totalPaid !== '') return Number(p.totalPaid);
  return (Number(p.amountPaid) || 0) + (Number(p.gstPaid) || 0);
};

export default function Loan() {
  const { data: loans, add: addLoan, update: updateLoan, remove: removeLoan } = useCollection('loans', 'createdAt');
  const { data: demands, add: addDemand, update: updateDemand, remove: removeDemand } = useCollection('demands', 'createdAt');
  const { data: payments, add: addPayment, update: updatePayment, remove: removePayment } = useCollection('payments', 'createdAt');
  const { data: flatCostDocs, add: addFlatCost, update: updateFlatCost } = useCollection('flatCost', 'createdAt');

  const flatCost = flatCostDocs[0] || null;

  const [tab, setTab] = useState('overview');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [editId, setEditId] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [showAllRecords, setShowAllRecords] = useState(false);

  const overview = useMemo(() => {
    const fc = flatCost || {};
    const agreementValue = Number(fc.agreementValue) || 0;
    const stampDuty = Number(fc.stampDuty) || 0;
    const gst = Number(fc.gst) || 0;
    const registration = Number(fc.registrationCharges) || 0;
    const legal = Number(fc.legalCharges) || 0;
    const totalCost = agreementValue + stampDuty + gst + registration + legal;

    const totalPaid = payments.reduce((s, p) => s + getPaymentTotal(p), 0);
    const outstanding = totalCost - totalPaid;

    const paidByCategory = {};
    PAYMENT_CATEGORIES.forEach(c => { paidByCategory[c] = 0; });
    payments.forEach(p => {
      const cat = p.category || 'Agreement Value';
      paidByCategory[cat] = (paidByCategory[cat] || 0) + getPaymentTotal(p);
    });

    const pendingDemands = demands
      .filter(d => d.status === 'Pending' || d.status === 'Partial')
      .filter(d => d.dueDate)
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    const nextDue = pendingDemands[0] || null;

    const taxesAndCharges = stampDuty + gst + registration;
    const taxesPct = totalCost > 0 ? (taxesAndCharges / totalCost * 100) : 0;
    const builderPaid = paidByCategory['Agreement Value'] || 0;
    const builderPct = agreementValue > 0 ? (builderPaid / agreementValue * 100) : 0;

    const breakdownItems = [
      { label: 'Agreement Value', value: agreementValue, color: CATEGORY_COLORS['Agreement Value'].hex },
      { label: 'Stamp Duty', value: stampDuty, color: CATEGORY_COLORS['Stamp Duty'].hex },
      { label: 'GST', value: gst, color: CATEGORY_COLORS['GST'].hex },
      { label: 'Registration', value: registration, color: CATEGORY_COLORS['Registration'].hex },
      { label: 'Legal Charges', value: legal, color: CATEGORY_COLORS['Legal Charges'].hex },
    ].filter(item => item.value > 0);

    const sortedPayments = [...payments].sort((a, b) => {
      const da = a.paymentDate ? new Date(a.paymentDate) : new Date(0);
      const db = b.paymentDate ? new Date(b.paymentDate) : new Date(0);
      return db - da;
    });

    return {
      agreementValue, totalCost, totalPaid, outstanding,
      paidByCategory, nextDue,
      taxesAndCharges, taxesPct,
      builderPaid, builderPct,
      breakdownItems, sortedPayments,
      paidPct: totalCost > 0 ? (totalPaid / totalCost * 100) : 0,
    };
  }, [flatCost, payments, demands]);

  const openAdd = (type, defaults) => { setForm(defaults); setEditId(null); setModal(type); };
  const openEdit = (type, item) => { setForm({ ...item }); setEditId(item.id); setModal(type); };

  const handleSave = async () => {
    if (modal === 'loan') {
      editId ? await updateLoan(editId, form) : await addLoan(form);
    } else if (modal === 'demand') {
      const totalDemand = (Number(form.demandAmount) || 0) + (Number(form.gstAmount) || 0);
      const data = { ...form, totalDemand };
      editId ? await updateDemand(editId, data) : await addDemand(data);
    } else if (modal === 'payment') {
      const isAgreement = (form.category || 'Agreement Value') === 'Agreement Value';
      if (isAgreement) {
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
          delayDays = Math.round((new Date(form.paymentDate) - new Date(demand.dueDate)) / 86400000);
        }
        const paymentData = { ...form, totalPaid, outstandingAmount, delayDays };
        editId ? await updatePayment(editId, paymentData) : await addPayment(paymentData);
      } else {
        const amount = Number(form.amountPaid) || 0;
        const paymentData = { ...form, gstPaid: 0, totalPaid: amount, outstandingAmount: null, delayDays: null, demandId: '' };
        editId ? await updatePayment(editId, paymentData) : await addPayment(paymentData);
      }
    } else if (modal === 'flatCost') {
      flatCost ? await updateFlatCost(flatCost.id, form) : await addFlatCost(form);
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
  const fmtDate = (d) => {
    if (!d) return '-';
    try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return d; }
  };
  const inputCls = 'w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white';

  const subTabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'loans', label: 'Loans' },
    { key: 'demands', label: 'Demands' },
    { key: 'payments', label: 'Payments' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
        {subTabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 text-xs sm:text-sm rounded-lg transition-colors ${
              tab === t.key ? 'bg-white dark:bg-gray-700 font-medium shadow-sm dark:text-white' : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ========== OVERVIEW TAB ========== */}
      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <div className="flex items-center gap-2 mb-1">
                <div className="p-1.5 bg-green-50 dark:bg-green-900/30 rounded-lg">
                  <HiOutlineCurrencyRupee className="w-4 h-4 text-green-600 dark:text-green-400" />
                </div>
                <span className="text-[11px] text-gray-500 dark:text-gray-400">Agreement Value</span>
              </div>
              <p className="text-base font-bold dark:text-white">{fmt(overview.agreementValue)}</p>
            </Card>
            <Card>
              <div className="flex items-center gap-2 mb-1">
                <div className="p-1.5 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
                  <HiOutlineDocumentText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                <span className="text-[11px] text-gray-500 dark:text-gray-400">Total Paid</span>
              </div>
              <p className="text-base font-bold dark:text-white">{fmt(overview.totalPaid)}</p>
              <p className="text-[10px] text-gray-400">{overview.paidPct.toFixed(1)}% of Total</p>
            </Card>
            <Card>
              <div className="flex items-center gap-2 mb-1">
                <div className="p-1.5 bg-amber-50 dark:bg-amber-900/30 rounded-lg">
                  <HiOutlineArrowTrendingUp className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                </div>
                <span className="text-[11px] text-gray-500 dark:text-gray-400">Outstanding</span>
              </div>
              <p className="text-base font-bold dark:text-white">{fmt(overview.outstanding)}</p>
              <p className="text-[10px] text-gray-400">
                {overview.totalCost > 0 ? ((overview.outstanding / overview.totalCost) * 100).toFixed(1) : 0}% of Total
              </p>
            </Card>
            <Card>
              <div className="flex items-center gap-2 mb-1">
                <div className="p-1.5 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg">
                  <HiOutlineClock className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                </div>
                <span className="text-[11px] text-gray-500 dark:text-gray-400">Next Due</span>
              </div>
              {overview.nextDue ? (
                <>
                  <p className="text-xs font-bold dark:text-white truncate">{overview.nextDue.constructionStage}</p>
                  <p className="text-[10px] text-indigo-600 dark:text-indigo-400 font-medium">{fmtDate(overview.nextDue.dueDate)}</p>
                </>
              ) : (
                <p className="text-xs text-gray-400 dark:text-gray-500">No pending dues</p>
              )}
            </Card>
          </div>

          {/* Flat Value Breakdown */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold dark:text-white">Flat Value Breakdown</h3>
              <button
                onClick={() => {
                  setForm(flatCost ? {
                    agreementValue: flatCost.agreementValue || '',
                    stampDuty: flatCost.stampDuty || '',
                    gst: flatCost.gst || '',
                    registrationCharges: flatCost.registrationCharges || '',
                    legalCharges: flatCost.legalCharges || '',
                  } : { ...emptyFlatCost });
                  setEditId(flatCost?.id || null);
                  setModal('flatCost');
                }}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                {flatCost ? 'Edit' : 'Set Up'}
              </button>
            </div>
            {flatCost && overview.totalCost > 0 ? (
              <>
                <div className="space-y-2.5">
                  {overview.breakdownItems.map(item => (
                    <div key={item.label} className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                        <span className="text-[11px] text-gray-600 dark:text-gray-300">{item.label}</span>
                      </div>
                      <span className="text-[11px] font-semibold dark:text-white">{fmt(item.value)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-700">
                    <span className="text-[11px] font-semibold dark:text-white">Total</span>
                    <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400">{fmt(overview.totalCost)}</span>
                  </div>
                </div>
                <div className="mt-4 p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl">
                  <div className="flex items-start gap-2">
                    <HiOutlineInformationCircle className="w-4 h-4 text-indigo-600 dark:text-indigo-400 mt-0.5 shrink-0" />
                    <div className="text-xs text-indigo-700 dark:text-indigo-300">
                      <p className="font-medium mb-0.5">Insight</p>
                      <p>
                        You&apos;ve paid {overview.paidPct.toFixed(1)}% of the total cost.
                        {overview.taxesPct > 0 && ` Stamp Duty and GST together make up ${overview.taxesPct.toFixed(1)}% of your total flat cost.`}
                      </p>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-6">
                <HiOutlineBanknotes className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <p className="text-xs text-gray-400">Set up your flat cost breakdown to see analysis</p>
              </div>
            )}
          </Card>

          {/* Payment Records */}
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold dark:text-white">Payment Schedule & Records</h3>
              {payments.length > 5 && (
                <button onClick={() => setShowAllRecords(!showAllRecords)}
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                  {showAllRecords ? 'Show Less' : 'See All'}
                </button>
              )}
            </div>
            {overview.sortedPayments.length > 0 ? (
              <div className="space-y-0 divide-y divide-gray-100 dark:divide-gray-700">
                {(showAllRecords ? overview.sortedPayments : overview.sortedPayments.slice(0, 5)).map(p => {
                  const cat = p.category || 'Agreement Value';
                  const catColor = CATEGORY_COLORS[cat] || CATEGORY_COLORS['Agreement Value'];
                  const demand = p.demandId ? demands.find(d => d.id === p.demandId) : null;
                  const label = p.particulars || demand?.constructionStage || cat;
                  const status = p.status || 'Paid';
                  return (
                    <div key={p.id} className="flex justify-between items-center py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium dark:text-white truncate">{label}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-gray-400 dark:text-gray-500">{fmtDate(p.paymentDate)}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${catColor.bg} ${catColor.text}`}>
                            {cat}
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <p className="text-sm font-semibold dark:text-white">{fmt(getPaymentTotal(p))}</p>
                        <p className={`text-[10px] font-medium ${
                          status === 'Paid' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'
                        }`}>{status}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-6">No payments recorded yet</p>
            )}
            <button onClick={() => openAdd('payment', emptyPayment)}
              className="mt-3 text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
              + Add New Payment
            </button>
          </Card>

          {/* Summary & Analysis */}
          {flatCost && overview.totalCost > 0 && (
            <Card>
              <h3 className="text-sm font-semibold mb-3 dark:text-white">Summary & Analysis</h3>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                  <HiOutlineBuildingOffice2 className="w-5 h-5 text-indigo-500 mx-auto mb-1" />
                  <p className="text-[10px] text-gray-500 dark:text-gray-400">Total Cost</p>
                  <p className="text-xs font-bold dark:text-white">{fmt(overview.totalCost)}</p>
                  <p className="text-[9px] text-gray-400 mt-0.5">Agreement + Duties</p>
                </div>
                <div className="text-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                  <HiOutlineCalculator className="w-5 h-5 text-blue-500 mx-auto mb-1" />
                  <p className="text-[10px] text-gray-500 dark:text-gray-400">Taxes & Charges</p>
                  <p className="text-xs font-bold dark:text-white">{fmt(overview.taxesAndCharges)}</p>
                  <p className="text-[9px] text-gray-400 mt-0.5">{overview.taxesPct.toFixed(1)}% of Total</p>
                </div>
                <div className="text-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                  <HiOutlineArrowTrendingUp className="w-5 h-5 text-green-500 mx-auto mb-1" />
                  <p className="text-[10px] text-gray-500 dark:text-gray-400">Builder Paid</p>
                  <p className="text-xs font-bold dark:text-white">{fmt(overview.builderPaid)}</p>
                  <p className="text-[9px] text-gray-400 mt-0.5">{overview.builderPct.toFixed(1)}% Completed</p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                  <span className="font-medium">Breakdown:</span>{' '}
                  {overview.breakdownItems.map((item, i) => (
                    <span key={item.label}>
                      {i > 0 && ' \u00b7 '}
                      {item.label} ({(item.value / overview.totalCost * 100).toFixed(1)}%)
                    </span>
                  ))}
                </p>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ========== LOANS TAB ========== */}
      {tab === 'loans' && (
        loans.length === 0 ? (
          <EmptyState icon={HiOutlineBanknotes} message="No loans added yet" />
        ) : (
          <div className="space-y-3">
            {loans.map(loan => (
              <Card key={loan.id}>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold dark:text-white">{loan.bankName}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">A/C: {loan.loanAccountNumber}</p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit('loan', loan)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><HiPencil className="w-4 h-4 text-gray-400" /></button>
                    <button onClick={() => confirmDelete('loan', loan.id, loan.bankName)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><HiTrash className="w-4 h-4 text-red-400" /></button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
                  <div><span className="text-gray-500 dark:text-gray-400">Sanctioned:</span> <span className="dark:text-white">{fmt(loan.sanctionAmount)}</span></div>
                  <div><span className="text-gray-500 dark:text-gray-400">Rate:</span> <span className="dark:text-white">{loan.interestRate}%</span></div>
                  <div><span className="text-gray-500 dark:text-gray-400">EMI:</span> <span className="dark:text-white">{fmt(loan.emiAmount)}</span></div>
                  <div><span className="text-gray-500 dark:text-gray-400">Tenure:</span> <span className="dark:text-white">{loan.tenure} months</span></div>
                  <div><span className="text-gray-500 dark:text-gray-400">Disbursed:</span> <span className="dark:text-white">{fmt(loan.totalDisbursed)}</span></div>
                  <div><span className="text-gray-500 dark:text-gray-400">Remaining:</span> <span className="dark:text-white">{fmt(loan.remainingAmount)}</span></div>
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      {/* ========== DEMANDS TAB ========== */}
      {tab === 'demands' && (
        demands.length === 0 ? (
          <EmptyState icon={HiOutlineBanknotes} message="No builder demands yet" />
        ) : (
          <div className="space-y-3">
            {demands.map(d => (
              <Card key={d.id}>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold dark:text-white">{d.constructionStage}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{d.demandDate}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      d.status === 'Paid' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                      d.status === 'Partial' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                      'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    }`}>{d.status}</span>
                    <button onClick={() => openEdit('demand', d)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><HiPencil className="w-4 h-4 text-gray-400" /></button>
                    <button onClick={() => confirmDelete('demand', d.id, d.constructionStage)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><HiTrash className="w-4 h-4 text-red-400" /></button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
                  <div><span className="text-gray-500 dark:text-gray-400">Amount:</span> <span className="dark:text-white">{fmt(d.demandAmount)}</span></div>
                  <div><span className="text-gray-500 dark:text-gray-400">GST:</span> <span className="dark:text-white">{fmt(d.gstAmount)}</span></div>
                  <div><span className="text-gray-500 dark:text-gray-400">Total:</span> <span className="dark:text-white">{fmt(d.totalDemand)}</span></div>
                  <div><span className="text-gray-500 dark:text-gray-400">Due:</span> <span className="dark:text-white">{d.dueDate}</span></div>
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      {/* ========== PAYMENTS TAB ========== */}
      {tab === 'payments' && (
        payments.length === 0 ? (
          <EmptyState icon={HiOutlineBanknotes} message="No payments recorded" />
        ) : (
          <div className="space-y-3">
            {payments.map(p => {
              const cat = p.category || 'Agreement Value';
              const catColor = CATEGORY_COLORS[cat] || CATEGORY_COLORS['Agreement Value'];
              const demand = p.demandId ? demands.find(d => d.id === p.demandId) : null;
              const label = p.particulars || demand?.constructionStage || cat;
              return (
                <Card key={p.id}>
                  <div className="flex justify-between items-start">
                    <div className="min-w-0">
                      <p className="font-semibold dark:text-white truncate">{label}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-500 dark:text-gray-400">{p.paymentDate}</span>
                        {cat !== 'Agreement Value' && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${catColor.bg} ${catColor.text}`}>{cat}</span>
                        )}
                        {cat === 'Agreement Value' && p.paidBy && (
                          <span className="text-xs text-gray-400 dark:text-gray-500">&middot; {p.paidBy}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0 ml-2">
                      <button onClick={() => openEdit('payment', p)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><HiPencil className="w-4 h-4 text-gray-400" /></button>
                      <button onClick={() => confirmDelete('payment', p.id, label)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><HiTrash className="w-4 h-4 text-red-400" /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
                    <div><span className="text-gray-500 dark:text-gray-400">Paid:</span> <span className="dark:text-white">{fmt(getPaymentTotal(p))}</span></div>
                    {cat === 'Agreement Value' && p.outstandingAmount != null && (
                      <div><span className="text-gray-500 dark:text-gray-400">Outstanding:</span> <span className="dark:text-white">{fmt(p.outstandingAmount)}</span></div>
                    )}
                    <div><span className="text-gray-500 dark:text-gray-400">Ref:</span> <span className="dark:text-white">{p.transactionRef || '-'}</span></div>
                    {p.delayDays != null && (
                      <div><span className="text-gray-500 dark:text-gray-400">Delay:</span> <span className="dark:text-white">{p.delayDays > 0 ? `${p.delayDays} days late` : 'On time'}</span></div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )
      )}

      {/* ========== LOAN MODAL ========== */}
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
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">{label}</label>
              <input type={type} value={form[key] || ''} onChange={e => set(key, e.target.value)} className={inputCls} />
            </div>
          ))}
          <button onClick={handleSave} className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors">
            {editId ? 'Update' : 'Save'}
          </button>
        </div>
      </Modal>

      {/* ========== DEMAND MODAL ========== */}
      <Modal open={modal === 'demand'} onClose={() => setModal(null)} title={editId ? 'Edit Demand' : 'Add Demand'}>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Demand Date</label>
            <input type="date" value={form.demandDate || ''} onChange={e => set('demandDate', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Construction Stage</label>
            <input type="text" value={form.constructionStage || ''} onChange={e => set('constructionStage', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Demand Amount</label>
            <input type="number" value={form.demandAmount || ''} onChange={e => {
              const amt = e.target.value;
              const gst = amt ? ((Number(amt) * (Number(form.gstPercent) || 0)) / 100).toFixed(2) : '';
              setForm(prev => ({ ...prev, demandAmount: amt, gstAmount: gst }));
            }} className={inputCls} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">GST %</label>
            <div className="flex gap-2">
              <input type="number" value={form.gstPercent ?? '5'} onChange={e => {
                const pct = e.target.value;
                const gst = form.demandAmount ? ((Number(form.demandAmount) * (Number(pct) || 0)) / 100).toFixed(2) : '';
                setForm(prev => ({ ...prev, gstPercent: pct, gstAmount: gst }));
              }} className="w-24 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white" />
              <input type="number" value={form.gstAmount || ''} onChange={e => set('gstAmount', e.target.value)}
                placeholder="GST amount" className={`flex-1 ${inputCls}`} />
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-700/50 p-3 rounded-xl text-sm">
            <span className="text-gray-500 dark:text-gray-400">Total Demand:</span>{' '}
            <span className="font-medium dark:text-white">{fmt((Number(form.demandAmount) || 0) + (Number(form.gstAmount) || 0))}</span>
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Due Date</label>
            <input type="date" value={form.dueDate || ''} onChange={e => set('dueDate', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Status</label>
            <select value={form.status || 'Pending'} onChange={e => set('status', e.target.value)} className={inputCls}>
              {DEMAND_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <button onClick={handleSave} className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors">
            {editId ? 'Update' : 'Save'}
          </button>
        </div>
      </Modal>

      {/* ========== PAYMENT MODAL ========== */}
      <Modal open={modal === 'payment'} onClose={() => setModal(null)} title={editId ? 'Edit Payment' : 'Add Payment'}>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Category</label>
            <select value={form.category || 'Agreement Value'} onChange={e => {
              const cat = e.target.value;
              setForm(prev => ({ ...prev, category: cat, particulars: CATEGORY_PARTICULARS[cat] || '' }));
            }} className={inputCls}>
              {PAYMENT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {(form.category || 'Agreement Value') === 'Agreement Value' ? (
            <>
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Demand</label>
                <select value={form.demandId || ''} onChange={e => set('demandId', e.target.value)} className={inputCls}>
                  <option value="">Select demand...</option>
                  {demands.map(d => (
                    <option key={d.id} value={d.id}>{d.constructionStage} - {fmt(d.totalDemand)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Paid By</label>
                <select value={form.paidBy || 'Self'} onChange={e => set('paidBy', e.target.value)} className={inputCls}>
                  <option value="Self">Self</option>
                  <option value="Bank">Bank</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Amount Paid</label>
                <input type="number" value={form.amountPaid || ''} onChange={e => set('amountPaid', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">GST Paid</label>
                <input type="number" value={form.gstPaid || ''} onChange={e => set('gstPaid', e.target.value)} className={inputCls} />
              </div>
              <div className="bg-gray-50 dark:bg-gray-700/50 p-3 rounded-xl text-sm">
                <span className="text-gray-500 dark:text-gray-400">Total Paid:</span>{' '}
                <span className="font-medium dark:text-white">{fmt((Number(form.amountPaid) || 0) + (Number(form.gstPaid) || 0))}</span>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Description</label>
                <input type="text" value={form.particulars || ''} onChange={e => set('particulars', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Amount</label>
                <input type="number" value={form.amountPaid || ''} onChange={e => set('amountPaid', e.target.value)} className={inputCls} />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Payment Date</label>
            <input type="date" value={form.paymentDate || ''} onChange={e => set('paymentDate', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Status</label>
            <select value={form.status || 'Paid'} onChange={e => set('status', e.target.value)} className={inputCls}>
              <option value="Paid">Paid</option>
              <option value="Pending">Pending</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Transaction Ref</label>
            <input type="text" value={form.transactionRef || ''} onChange={e => set('transactionRef', e.target.value)} className={inputCls} />
          </div>
          <button onClick={handleSave} className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors">
            {editId ? 'Update Payment' : 'Save Payment'}
          </button>
        </div>
      </Modal>

      {/* ========== FLAT COST MODAL ========== */}
      <Modal open={modal === 'flatCost'} onClose={() => setModal(null)} title={flatCost ? 'Edit Flat Cost Breakdown' : 'Set Up Flat Cost'}>
        <div className="space-y-3">
          {[
            ['agreementValue', 'Agreement Value'],
            ['stampDuty', 'Stamp Duty'],
            ['gst', 'GST'],
            ['registrationCharges', 'Registration Charges'],
            ['legalCharges', 'Legal Charges'],
          ].map(([key, label]) => (
            <div key={key}>
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">{label}</label>
              <input type="number" value={form[key] || ''} onChange={e => set(key, e.target.value)} className={inputCls} />
            </div>
          ))}
          <div className="bg-gray-50 dark:bg-gray-700/50 p-3 rounded-xl text-sm">
            <span className="text-gray-500 dark:text-gray-400">Total Flat Cost:</span>{' '}
            <span className="font-medium dark:text-white">
              {fmt(
                (Number(form.agreementValue) || 0) + (Number(form.stampDuty) || 0) +
                (Number(form.gst) || 0) + (Number(form.registrationCharges) || 0) +
                (Number(form.legalCharges) || 0)
              )}
            </span>
          </div>
          <button onClick={handleSave} className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors">
            {flatCost ? 'Update' : 'Save'}
          </button>
        </div>
      </Modal>

      {/* Floating Add Button */}
      <button
        onClick={() => {
          if (tab === 'loans') openAdd('loan', emptyLoan);
          else if (tab === 'demands') openAdd('demand', emptyDemand);
          else openAdd('payment', emptyPayment);
        }}
        className="fixed bottom-20 right-6 z-40 p-3.5 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 active:scale-95 transition-all"
      >
        <HiPlus className="w-6 h-6" />
      </button>

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
