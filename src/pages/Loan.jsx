import { useState, useMemo, useEffect } from 'react';
import { useCollection } from '../hooks/useFirestore';
import Card from '../components/Card';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import {
  addDisbursement,
  calculateMonthlyBreakdown,
  generateAmortizationSchedule,
  recomputeLoanAggregates,
} from '../lib/cloudFunctions';
import {
  HiOutlineBanknotes, HiPlus, HiTrash, HiPencil,
  HiOutlineCurrencyRupee, HiOutlineDocumentText,
  HiOutlineArrowTrendingUp, HiOutlineClock,
  HiOutlineBuildingOffice2, HiOutlineCalculator,
  HiOutlineInformationCircle, HiOutlineArrowPath, HiOutlineCheckCircle,
  HiOutlineExclamationTriangle, HiOutlineBellAlert,
  HiOutlineChartBar, HiOutlineFire, HiOutlineArrowsRightLeft,
} from 'react-icons/hi2';

const PAYMENT_CATEGORIES = ['Agreement Value', 'Stamp Duty', 'Registration', 'GST', 'Legal Charges', 'Maintenance', 'Other Charges'];
const CATEGORY_COLORS = {
  'Agreement Value': { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400', hex: '#22c55e' },
  'Stamp Duty': { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400', hex: '#3b82f6' },
  'Registration': { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-400', hex: '#a855f7' },
  'GST': { bg: 'bg-cyan-100 dark:bg-cyan-900/30', text: 'text-cyan-700 dark:text-cyan-400', hex: '#06b6d4' },
  'Legal Charges': { bg: 'bg-pink-100 dark:bg-pink-900/30', text: 'text-pink-700 dark:text-pink-400', hex: '#ec4899' },
  'Maintenance': { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-400', hex: '#f97316' },
  'Other Charges': { bg: 'bg-gray-200 dark:bg-gray-600/30', text: 'text-gray-700 dark:text-gray-400', hex: '#6b7280' },
};
const CATEGORY_PARTICULARS = {
  'Agreement Value': '',
  'Stamp Duty': 'Stamp Duty',
  'Registration': 'Registration Charges',
  'GST': 'GST @ Actuals',
  'Legal Charges': 'Legal Charges',
  'Maintenance': 'Maintenance (2 Years)',
  'Other Charges': 'Other Charges',
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
  maintenance: '', otherCharges: '',
};
const emptyDisbursement = {
  loanId: '', amount: '', disbursementDate: '', utrNumber: '', stageId: '', remarks: '',
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

// --- date helpers used by timeline + alerts ---
const toDate = (val) => {
  if (!val) return null;
  if (val.toDate) return val.toDate(); // Firestore Timestamp
  if (val.seconds) return new Date(val.seconds * 1000);
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
};
const daysBetween = (a, b) => Math.round((a.getTime() - b.getTime()) / 86400000);
const formatINR = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const formatINRCompact = (n) => {
  const v = Number(n || 0);
  if (v >= 1_00_00_000) return `₹${(v / 1_00_00_000).toFixed(1)}Cr`;
  if (v >= 1_00_000)    return `₹${(v / 1_00_000).toFixed(1)}L`;
  if (v >= 1_000)       return `₹${(v / 1_000).toFixed(1)}K`;
  return `₹${v.toFixed(0)}`;
};

/* -------------------------------------------------------------------------
 * Next slab payment due banner.
 *
 * Picks the demand with the earliest dueDate that is still Pending or Partial
 * and renders a tonal banner. Colour bumps by urgency:
 *   red    - overdue
 *   amber  - due within 14 days
 *   indigo - upcoming
 *
 * Returns null when nothing's due so the caller can drop the slot from the
 * layout instead of rendering an empty card.
 * ----------------------------------------------------------------------- */
function NextPaymentAlert({ demands, onView }) {
  const next = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const pending = demands
      .filter(d => d.status === 'Pending' || d.status === 'Partial')
      .filter(d => d.dueDate)
      .map(d => ({ ...d, _due: toDate(d.dueDate) }))
      .filter(d => d._due)
      .sort((a, b) => a._due - b._due);
    return pending[0] || null;
  }, [demands]);

  if (!next) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = daysBetween(next._due, today);
  const overdue = days < 0;
  const soon = days >= 0 && days <= 14;

  const palette = overdue
    ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'
    : soon
      ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800'
      : 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800';

  const lead = overdue
    ? `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`
    : days === 0
      ? 'Due today'
      : `Due in ${days} day${days === 1 ? '' : 's'}`;

  const total = (Number(next.demandAmount) || 0) + (Number(next.gstAmount) || 0) || Number(next.totalDemand) || 0;

  return (
    <div className={`flex items-start gap-2 p-3 rounded-xl text-xs border ${palette}`} role={overdue ? 'alert' : 'status'}>
      <HiOutlineBellAlert className="w-4 h-4 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold truncate">
          Next slab payment: {next.constructionStage || 'Builder demand'}
        </p>
        <p className="opacity-80">
          {lead} {'\u00b7'} {formatINR(total)} {'\u00b7'} due {next._due.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
        </p>
      </div>
      {onView && (
        <button onClick={onView} className="text-[11px] font-medium hover:underline shrink-0">
          View
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Loan timeline (Stage -> Payment -> Disbursement)
 *
 * Merges three event types into one chronological list:
 *   - demand        (a builder slab demand was raised)
 *   - payment       (a payment was made against a demand)
 *   - disbursement  (the bank released money against the loan)
 *
 * Each entry shows the date, the event icon/colour, the amount and a one-line
 * description. Payments and disbursements that link to a demand/stage show
 * that linkage inline so the user can see the chain at a glance.
 * ----------------------------------------------------------------------- */
function LoanTimeline({ demands, payments, disbursements, fmtDate }) {
  const events = useMemo(() => {
    const items = [];

    demands.forEach(d => {
      const date = toDate(d.demandDate) || toDate(d.dueDate);
      if (!date) return;
      const total = (Number(d.demandAmount) || 0) + (Number(d.gstAmount) || 0) || Number(d.totalDemand) || 0;
      items.push({
        id: `demand-${d.id}`,
        type: 'demand',
        date,
        title: d.constructionStage || 'Builder demand',
        sub: d.status === 'Paid' ? 'Settled' : d.status === 'Partial' ? 'Partially settled' : 'Pending',
        amount: total,
        meta: d.dueDate ? `Due ${new Date(d.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : '',
        status: d.status,
      });
    });

    payments.forEach(p => {
      const date = toDate(p.paymentDate);
      if (!date) return;
      const linkedDemand = p.demandId ? demands.find(d => d.id === p.demandId) : null;
      items.push({
        id: `payment-${p.id}`,
        type: 'payment',
        date,
        title: p.particulars || linkedDemand?.constructionStage || p.category || 'Payment',
        sub: linkedDemand ? `Settles: ${linkedDemand.constructionStage}` : (p.category || 'Direct payment'),
        amount: getPaymentTotal(p),
        meta: p.paidBy === 'Bank' ? 'Paid by bank' : 'Paid from own funds',
        status: p.status,
      });
    });

    disbursements.forEach(d => {
      const date = toDate(d.disbursementDate);
      if (!date) return;
      items.push({
        id: `disb-${d.id}`,
        type: 'disbursement',
        date,
        title: 'Bank disbursement',
        sub: d.remarks || (d.stageId ? 'Linked to stage' : 'Loan release'),
        amount: Number(d.amount) || 0,
        meta: d.utrNumber ? `UTR ${d.utrNumber}` : '',
        status: 'completed',
      });
    });

    return items.sort((a, b) => b.date - a.date);
  }, [demands, payments, disbursements]);

  if (events.length === 0) {
    return <EmptyState icon={HiOutlineClock} message="Nothing on the timeline yet" />;
  }

  const styles = {
    demand:       { dot: 'bg-amber-500',  bar: 'bg-amber-100 dark:bg-amber-900/30',  txt: 'text-amber-700 dark:text-amber-400',  label: 'Demand'       },
    payment:      { dot: 'bg-emerald-500', bar: 'bg-emerald-100 dark:bg-emerald-900/30', txt: 'text-emerald-700 dark:text-emerald-400', label: 'Payment'      },
    disbursement: { dot: 'bg-indigo-500', bar: 'bg-indigo-100 dark:bg-indigo-900/30', txt: 'text-indigo-700 dark:text-indigo-400', label: 'Disbursement' },
  };

  return (
    <ol className="relative pl-5">
      <span className="absolute left-1.5 top-1 bottom-1 w-px bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
      {events.map(e => {
        const s = styles[e.type];
        return (
          <li key={e.id} className="relative pb-3">
            <span className={`absolute -left-3.5 top-1.5 w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-gray-800 ${s.dot}`} />
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${s.bar} ${s.txt}`}>
                    {s.label}
                  </span>
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">{fmtDate(e.date)}</span>
                </div>
                <p className="text-sm font-medium dark:text-white truncate mt-0.5">{e.title}</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{e.sub}</p>
                {e.meta && (
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate mt-0.5">{e.meta}</p>
                )}
              </div>
              <p className="text-sm font-semibold dark:text-white whitespace-nowrap">
                {formatINR(e.amount)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* -------------------------------------------------------------------------
 * Pre-EMI vs Full EMI scenario comparison.
 *
 * Takes the two raw payloads from generateAmortizationSchedule and renders
 * a side-by-side card pair plus a verdict line summarising the trade-off.
 *
 * The math is already done server-side; we just diff the two summaries.
 * ----------------------------------------------------------------------- */
function ScenarioCompare({ full, pre }) {
  const fullSum = full?.schedule?.summary || {};
  const preSum = pre?.schedule?.summary || {};
  const fullMonthly = fullSum.monthlyPayment || 0;
  const preMonthly = preSum.monthlyPayment || 0;
  const interestDiff = (fullSum.totalInterest || 0) - (preSum.totalInterest || 0);
  const monthlyDiff = fullMonthly - preMonthly;
  const tenure = fullSum.tenureMonths || 0;
  const cashFlowDiff = monthlyDiff * tenure;

  const Box = ({ tone, label, monthly, totalInterest, finalBalance, note }) => (
    <div className={`rounded-xl p-3 border ${tone}`}>
      <p className="text-[10px] uppercase tracking-wide font-semibold opacity-70">{label}</p>
      <p className="text-base font-bold mt-1">{formatINR(monthly)}<span className="text-[10px] font-normal opacity-70"> /mo</span></p>
      <div className="grid grid-cols-2 gap-2 mt-2 text-[10px]">
        <div>
          <p className="opacity-70">Total interest</p>
          <p className="font-semibold">{formatINRCompact(totalInterest)}</p>
        </div>
        <div>
          <p className="opacity-70">Final balance</p>
          <p className="font-semibold">{formatINRCompact(finalBalance)}</p>
        </div>
      </div>
      {note && <p className="text-[10px] opacity-70 mt-1">{note}</p>}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Box
          tone="bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 text-indigo-900 dark:text-indigo-100"
          label="Full EMI"
          monthly={fullMonthly}
          totalInterest={fullSum.totalInterest}
          finalBalance={fullSum.finalBalance}
          note={`${tenure} months, principal cleared at end`}
        />
        <Box
          tone="bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100"
          label="Pre-EMI (interest only)"
          monthly={preMonthly}
          totalInterest={preSum.totalInterest}
          finalBalance={preSum.finalBalance}
          note="Principal stays parked - cleared by separate EMI later"
        />
      </div>

      <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 p-3 text-[11px] space-y-1.5">
        <p className="font-semibold text-gray-800 dark:text-gray-100">Verdict over {tenure} months</p>
        <p className="text-gray-600 dark:text-gray-300">
          Full EMI costs {' '}
          <span className={interestDiff >= 0 ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-red-600 dark:text-red-400 font-semibold'}>
            {formatINRCompact(Math.abs(interestDiff))}
          </span>{' '}
          {interestDiff >= 0 ? 'more' : 'less'} interest than Pre-EMI - because Pre-EMI doesn&apos;t reduce principal so the principal still has to be repaid afterwards.
        </p>
        <p className="text-gray-600 dark:text-gray-300">
          Monthly cash flow:{' '}
          <span className="font-semibold">
            +{formatINRCompact(Math.abs(monthlyDiff))} per month
          </span>{' '}
          for Full EMI ({formatINRCompact(Math.abs(cashFlowDiff))} extra cash committed across the tenure, but the loan actually closes at the end).
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Interest burn chart
 *
 * Pure-SVG line chart with a filled area underneath. Shows the monthly
 * interest the borrower pays for the lifetime of the loan, using the
 * `calculateMonthlyBreakdown` callable as the data source.
 *
 * SVG is intentional - avoids a 50kB charting dependency for a chart we
 * fully own. Layout is responsive via viewBox.
 * ----------------------------------------------------------------------- */
function InterestBurnChart({ data }) {
  if (!data || data.length === 0) return null;

  const W = 600;
  const H = 180;
  const PAD_L = 44;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 24;

  const max = Math.max(...data, 1);
  const min = 0;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const stepX = innerW / Math.max(1, data.length - 1);
  const yOf = (v) => PAD_T + innerH - ((v - min) / (max - min || 1)) * innerH;
  const xOf = (i) => PAD_L + i * stepX;

  const linePath = data
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(2)} ${yOf(v).toFixed(2)}`)
    .join(' ');
  const areaPath = `${linePath} L ${xOf(data.length - 1).toFixed(2)} ${(PAD_T + innerH).toFixed(2)} L ${xOf(0).toFixed(2)} ${(PAD_T + innerH).toFixed(2)} Z`;

  // four y-axis ticks + bottom-axis ticks at month 1, every quarter, last
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => min + t * (max - min));
  const xTickIdx = [0];
  const everyMonths = Math.max(1, Math.round(data.length / 6));
  for (let i = everyMonths; i < data.length - 1; i += everyMonths) xTickIdx.push(i);
  xTickIdx.push(data.length - 1);

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ minWidth: 320 }}>
        <defs>
          <linearGradient id="burnGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#f97316" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#f97316" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {yTicks.map((t, i) => (
          <g key={`y${i}`}>
            <line x1={PAD_L} x2={W - PAD_R} y1={yOf(t)} y2={yOf(t)} stroke="currentColor" className="text-gray-200 dark:text-gray-700" strokeWidth="1" />
            <text x={PAD_L - 6} y={yOf(t) + 3} textAnchor="end" className="fill-gray-500 dark:fill-gray-400" style={{ fontSize: 9 }}>
              {formatINRCompact(t)}
            </text>
          </g>
        ))}
        <path d={areaPath} fill="url(#burnGrad)" />
        <path d={linePath} fill="none" stroke="#f97316" strokeWidth="2" />
        {xTickIdx.map(i => (
          <text key={`x${i}`} x={xOf(i)} y={H - 6} textAnchor="middle" className="fill-gray-500 dark:fill-gray-400" style={{ fontSize: 9 }}>
            {`M${i + 1}`}
          </text>
        ))}
      </svg>
    </div>
  );
}


export default function Loan() {
  const { data: loans, add: addLoan, update: updateLoan, remove: removeLoan } = useCollection('loans', 'createdAt');
  const { data: demands, add: addDemand, update: updateDemand, remove: removeDemand } = useCollection('demands', 'createdAt');
  const { data: payments, add: addPayment, update: updatePayment, remove: removePayment } = useCollection('payments', 'createdAt');
  const { data: flatCostDocs, add: addFlatCost, update: updateFlatCost } = useCollection('flatCost', 'createdAt');
  // New collection - read-only on the client; writes go through the
  // addDisbursement Cloud Function which keeps loan aggregates in sync.
  const { data: disbursements } = useCollection('disbursements', 'disbursementDate');

  const flatCost = flatCostDocs[0] || null;

  const [tab, setTab] = useState('overview');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [editId, setEditId] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [showAllRecords, setShowAllRecords] = useState(false);
  // Cloud Function feedback (banner above the active tab).
  const [actionState, setActionState] = useState(null); // { kind: 'ok'|'err', text }
  const [submitting, setSubmitting] = useState(false);
  const [recomputingId, setRecomputingId] = useState(null);

  // Insights tab: which loan we're analysing + cached breakdown payload.
  const [insightLoanId, setInsightLoanId] = useState(null);
  const [insightData, setInsightData] = useState(null);   // result of calculateMonthlyBreakdown
  const [insightError, setInsightError] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  // Pre-EMI vs Full EMI simulator: cache scheduled scenarios.
  const [simData, setSimData] = useState(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState(null);

  const overview = useMemo(() => {
    const fc = flatCost || {};
    const agreementValue = Number(fc.agreementValue) || 0;
    const stampDuty = Number(fc.stampDuty) || 0;
    const gst = Number(fc.gst) || 0;
    const registration = Number(fc.registrationCharges) || 0;
    const legal = Number(fc.legalCharges) || 0;
    const maintenance = Number(fc.maintenance) || 0;
    const otherCharges = Number(fc.otherCharges) || 0;
    const totalCost = agreementValue + stampDuty + gst + registration + legal + maintenance + otherCharges;

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
      { label: 'Maintenance', value: maintenance, color: CATEGORY_COLORS['Maintenance'].hex },
      { label: 'Other Charges', value: otherCharges, color: CATEGORY_COLORS['Other Charges'].hex },
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
    } else if (modal === 'disbursement') {
      // Cloud Function path - close immediately so the user can't double
      // submit while the network call is in flight, then surface success
      // or error in the inline banner.
      const payload = {
        loanId: form.loanId,
        amount: Number(form.amount),
        disbursementDate: form.disbursementDate,
        utrNumber: form.utrNumber,
        stageId: form.stageId || undefined,
        remarks: form.remarks || '',
      };
      setSubmitting(true);
      setModal(null);
      try {
        const result = await addDisbursement(payload);
        setActionState({
          kind: 'ok',
          text: `Disbursement saved \u00b7 disbursed total ${fmt(result.loanAggregates.disbursedAmount)} \u00b7 ${result.loanAggregates.disbursementPercentage.toFixed(1)}% of sanction`,
        });
      } catch (err) {
        setActionState({
          kind: 'err',
          text: `${err.code || 'error'}: ${err.message}`,
        });
        // re-open the modal so the user can correct & retry
        setModal('disbursement');
      } finally {
        setSubmitting(false);
      }
      return;
    }
    setModal(null);
  };

  const handleRecompute = async (loanId) => {
    setRecomputingId(loanId);
    setActionState(null);
    try {
      const result = await recomputeLoanAggregates({ loanId });
      setActionState({
        kind: 'ok',
        text: `Recomputed: disbursed ${fmt(result.loanAggregates.disbursedAmount)}, EMI ${fmt(result.loanAggregates.emi)}, Pre-EMI ${fmt(result.loanAggregates.preEmi)}`,
      });
    } catch (err) {
      setActionState({
        kind: 'err',
        text: `${err.code || 'error'}: ${err.message}`,
      });
    } finally {
      setRecomputingId(null);
    }
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
    { key: 'disbursements', label: 'Disbursements' },
    { key: 'demands', label: 'Demands' },
    { key: 'payments', label: 'Payments' },
    { key: 'insights', label: 'Insights' },
  ];

  // Default the insight loan to the first loan once data loads, so the
  // Insights tab has something to show without forcing a manual selection.
  useEffect(() => {
    if (!insightLoanId && loans.length > 0) {
      setInsightLoanId(loans[0].id);
    }
  }, [loans, insightLoanId]);

  // Fetch the monthly breakdown whenever the user lands on Insights or
  // changes the selected loan. Cached per loanId so re-tabbing is free.
  useEffect(() => {
    if (tab !== 'insights' || !insightLoanId) return;
    let cancelled = false;
    setInsightLoading(true);
    setInsightError(null);
    calculateMonthlyBreakdown({ loanId: insightLoanId })
      .then(res => { if (!cancelled) setInsightData(res); })
      .catch(err => { if (!cancelled) setInsightError(`${err.code || 'error'}: ${err.message}`); })
      .finally(() => { if (!cancelled) setInsightLoading(false); });
    return () => { cancelled = true; };
  }, [tab, insightLoanId]);

  // Run the Pre-EMI vs Full EMI simulation in parallel for the active loan.
  // Two scheduled what-ifs on the same loan with the repaymentType swapped.
  const runSimulation = async () => {
    if (!insightLoanId) return;
    setSimLoading(true);
    setSimError(null);
    try {
      const [fullEmi, preEmi] = await Promise.all([
        generateAmortizationSchedule({
          loanId: insightLoanId,
          overrides: { repaymentType: 'FULL_EMI' },
        }),
        generateAmortizationSchedule({
          loanId: insightLoanId,
          overrides: { repaymentType: 'PRE_EMI' },
        }),
      ]);
      setSimData({ fullEmi, preEmi });
    } catch (err) {
      setSimError(`${err.code || 'error'}: ${err.message}`);
    } finally {
      setSimLoading(false);
    }
  };
  // Auto-run the simulation the first time the user opens Insights for a
  // given loan; clear it when the loan changes.
  useEffect(() => {
    setSimData(null);
    setSimError(null);
  }, [insightLoanId]);

  const fmtTimestamp = (ts) => {
    if (!ts) return '-';
    // Firestore Timestamp from server has .seconds; parsed snapshot has .toDate
    const d = ts.toDate ? ts.toDate() : (ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts));
    if (Number.isNaN(d.getTime?.())) return '-';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  return (
    <div className="space-y-4">
      <NextPaymentAlert demands={demands} onView={() => setTab('demands')} />

      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl overflow-x-auto">
        {subTabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 min-w-fit px-2 py-2 text-xs sm:text-sm rounded-lg transition-colors whitespace-nowrap ${
              tab === t.key ? 'bg-white dark:bg-gray-700 font-medium shadow-sm dark:text-white' : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {actionState && (
        <div
          className={`flex items-start gap-2 p-3 rounded-xl text-xs ${
            actionState.kind === 'ok'
              ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
          }`}
          role={actionState.kind === 'err' ? 'alert' : 'status'}
        >
          {actionState.kind === 'ok'
            ? <HiOutlineCheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
            : <HiOutlineExclamationTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span className="flex-1">{actionState.text}</span>
          <button onClick={() => setActionState(null)} className="text-[11px] hover:underline shrink-0">Dismiss</button>
        </div>
      )}

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
                    maintenance: flatCost.maintenance || '',
                    otherCharges: flatCost.otherCharges || '',
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
                    <button
                      onClick={() => handleRecompute(loan.id)}
                      disabled={recomputingId === loan.id}
                      title="Recompute aggregates from disbursements + builder payments"
                      className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg disabled:opacity-50"
                    >
                      <HiOutlineArrowPath className={`w-4 h-4 text-indigo-500 ${recomputingId === loan.id ? 'animate-spin' : ''}`} />
                    </button>
                    <button onClick={() => openEdit('loan', loan)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><HiPencil className="w-4 h-4 text-gray-400" /></button>
                    <button onClick={() => confirmDelete('loan', loan.id, loan.bankName)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><HiTrash className="w-4 h-4 text-red-400" /></button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
                  <div><span className="text-gray-500 dark:text-gray-400">Sanctioned:</span> <span className="dark:text-white">{fmt(loan.sanctionAmount)}</span></div>
                  <div><span className="text-gray-500 dark:text-gray-400">Rate:</span> <span className="dark:text-white">{loan.interestRate}%</span></div>
                  <div><span className="text-gray-500 dark:text-gray-400">EMI:</span> <span className="dark:text-white">{fmt(loan.emi || loan.emiAmount)}</span></div>
                  <div><span className="text-gray-500 dark:text-gray-400">Pre-EMI:</span> <span className="dark:text-white">{fmt(loan.preEmi || loan.preEmiAmount)}</span></div>
                  <div><span className="text-gray-500 dark:text-gray-400">Tenure:</span> <span className="dark:text-white">{loan.tenure || (loan.tenureYears && `${loan.tenureYears * 12}`) || '-'} months</span></div>
                  <div><span className="text-gray-500 dark:text-gray-400">Disbursed:</span> <span className="dark:text-white">{fmt(loan.disbursedAmount || loan.totalDisbursed)}</span></div>
                  <div><span className="text-gray-500 dark:text-gray-400">Remaining:</span> <span className="dark:text-white">{fmt(loan.totalLoanOutstanding || loan.remainingAmount)}</span></div>
                  <div><span className="text-gray-500 dark:text-gray-400">Disbursed %:</span> <span className="dark:text-white">{(loan.disbursementPercentage ?? 0).toFixed(1)}%</span></div>
                </div>
                {loan.sanctionAmount > 0 && (
                  <div className="mt-3 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500"
                      style={{ width: `${Math.min(100, loan.disbursementPercentage || 0)}%` }}
                    />
                  </div>
                )}
              </Card>
            ))}
          </div>
        )
      )}

      {/* ========== DISBURSEMENTS TAB ========== */}
      {tab === 'disbursements' && (
        <div className="space-y-3">
          {loans.length === 0 ? (
            <EmptyState icon={HiOutlineBanknotes} message="Add a loan first before recording disbursements" />
          ) : (
            <>
              <div className="flex gap-2">
                <button
                  onClick={() => openAdd('disbursement', { ...emptyDisbursement, loanId: loans[0]?.id || '', disbursementDate: new Date().toISOString().slice(0, 10) })}
                  className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors flex items-center justify-center gap-1"
                >
                  <HiPlus className="w-4 h-4" /> Add Disbursement
                </button>
              </div>

              {disbursements.length === 0 ? (
                <EmptyState icon={HiOutlineBanknotes} message="No disbursements yet" />
              ) : (
                disbursements.map(d => {
                  const loan = loans.find(l => l.id === d.loanId);
                  return (
                    <Card key={d.id}>
                      <div className="flex justify-between items-start">
                        <div className="min-w-0">
                          <p className="font-semibold dark:text-white truncate">
                            {fmt(d.amount)}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {loan ? loan.bankName : 'Unknown loan'} {'\u00b7'} {fmtTimestamp(d.disbursementDate)}
                          </p>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 rounded-full font-mono">
                          UTR: {d.utrNumber}
                        </span>
                      </div>
                      {d.remarks && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{d.remarks}</p>
                      )}
                    </Card>
                  );
                })
              )}

              <p className="text-[11px] text-gray-400 dark:text-gray-500 px-1">
                Disbursements are saved through a Cloud Function that atomically updates the loan&apos;s disbursed total, EMI, Pre-EMI and outstanding balance. UTR is mandatory and globally unique.
              </p>
            </>
          )}
        </div>
      )}

      {/* ========== INSIGHTS TAB ========== */}
      {tab === 'insights' && (
        <div className="space-y-3">
          {loans.length === 0 ? (
            <EmptyState icon={HiOutlineChartBar} message="Add a loan to see insights" />
          ) : (
            <>
              {/* Loan picker (only shown when more than one loan exists) */}
              {loans.length > 1 && (
                <Card>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Analysing loan</label>
                  <select
                    value={insightLoanId || ''}
                    onChange={e => setInsightLoanId(e.target.value)}
                    className={inputCls}
                  >
                    {loans.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.bankName} {l.loanAccountNumber ? `(${l.loanAccountNumber})` : ''}
                      </option>
                    ))}
                  </select>
                </Card>
              )}

              {insightLoading && (
                <Card>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Crunching the numbers...</p>
                </Card>
              )}
              {insightError && (
                <Card>
                  <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400">
                    <HiOutlineExclamationTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{insightError}</span>
                  </div>
                </Card>
              )}

              {/* ----- Timeline ----- */}
              <Card>
                <div className="flex items-center gap-2 mb-3">
                  <HiOutlineClock className="w-4 h-4 text-indigo-500" />
                  <h3 className="text-sm font-semibold dark:text-white">Timeline</h3>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">Stage {'\u2192'} Payment {'\u2192'} Disbursement</span>
                </div>
                <LoanTimeline
                  demands={demands}
                  payments={payments}
                  disbursements={(disbursements || []).filter(d => !insightLoanId || d.loanId === insightLoanId)}
                  fmtDate={fmtDate}
                />
              </Card>

              {/* ----- Interest burn graph ----- */}
              <Card>
                <div className="flex items-center gap-2 mb-2">
                  <HiOutlineFire className="w-4 h-4 text-orange-500" />
                  <h3 className="text-sm font-semibold dark:text-white">Interest burn</h3>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">monthly interest paid to the bank</span>
                </div>
                {insightData?.monthly?.interest?.length > 0 ? (
                  <>
                    <InterestBurnChart data={insightData.monthly.interest} />
                    <div className="grid grid-cols-3 gap-2 mt-3 text-[11px]">
                      <div className="rounded-lg bg-orange-50 dark:bg-orange-900/20 p-2">
                        <p className="text-gray-500 dark:text-gray-400">First month</p>
                        <p className="font-semibold text-orange-700 dark:text-orange-400">{formatINR(insightData.monthly.interest[0])}</p>
                      </div>
                      <div className="rounded-lg bg-orange-50 dark:bg-orange-900/20 p-2">
                        <p className="text-gray-500 dark:text-gray-400">Total interest</p>
                        <p className="font-semibold text-orange-700 dark:text-orange-400">{formatINRCompact(insightData.summary?.totalInterest || 0)}</p>
                      </div>
                      <div className="rounded-lg bg-orange-50 dark:bg-orange-900/20 p-2">
                        <p className="text-gray-500 dark:text-gray-400">Avg / month</p>
                        <p className="font-semibold text-orange-700 dark:text-orange-400">
                          {formatINRCompact((insightData.summary?.totalInterest || 0) / Math.max(1, insightData.monthly.interest.length))}
                        </p>
                      </div>
                    </div>
                  </>
                ) : (
                  !insightLoading && <p className="text-[11px] text-gray-500 dark:text-gray-400">No schedule available yet. Set a sanction amount, interest rate and tenure on the loan.</p>
                )}
              </Card>

              {/* ----- Pre-EMI vs Full EMI simulator ----- */}
              <Card>
                <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <HiOutlineArrowsRightLeft className="w-4 h-4 text-indigo-500" />
                    <h3 className="text-sm font-semibold dark:text-white">Simulate Pre-EMI vs Full EMI</h3>
                  </div>
                  <button
                    onClick={runSimulation}
                    disabled={simLoading || !insightLoanId}
                    className="text-[11px] px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {simLoading ? 'Simulating...' : simData ? 'Re-run' : 'Run simulation'}
                  </button>
                </div>
                {simError && (
                  <p className="text-[11px] text-red-600 dark:text-red-400 mb-2">{simError}</p>
                )}
                {!simData && !simLoading && (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    Compares total interest, monthly cash flow and final balance under each repayment mode for this loan&apos;s current disbursed amount.
                  </p>
                )}
                {simData && (
                  <ScenarioCompare full={simData.fullEmi} pre={simData.preEmi} />
                )}
              </Card>
            </>
          )}
        </div>
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
                    <div className="truncate"><span className="text-gray-500 dark:text-gray-400">Ref:</span> <span className="dark:text-white">{p.transactionRef || '-'}</span></div>
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
            ['maintenance', 'Maintenance (2 Years)'],
            ['otherCharges', 'Other Charges'],
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
                (Number(form.legalCharges) || 0) + (Number(form.maintenance) || 0) +
                (Number(form.otherCharges) || 0)
              )}
            </span>
          </div>
          <button onClick={handleSave} className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors">
            {flatCost ? 'Update' : 'Save'}
          </button>
        </div>
      </Modal>

      {/* ========== DISBURSEMENT MODAL ========== */}
      <Modal open={modal === 'disbursement'} onClose={() => setModal(null)} title="Add Disbursement">
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Loan</label>
            <select
              value={form.loanId || ''}
              onChange={e => set('loanId', e.target.value)}
              className={inputCls}
            >
              <option value="">Select loan...</option>
              {loans.map(l => (
                <option key={l.id} value={l.id}>
                  {l.bankName} {l.loanAccountNumber ? `(${l.loanAccountNumber})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Amount (₹)</label>
            <input
              type="number" inputMode="decimal" step="0.01" min="0"
              value={form.amount || ''} onChange={e => set('amount', e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Disbursement Date</label>
            <input
              type="date"
              value={form.disbursementDate || ''} onChange={e => set('disbursementDate', e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">UTR / Transaction Ref</label>
            <input
              type="text" value={form.utrNumber || ''}
              onChange={e => set('utrNumber', e.target.value.toUpperCase())}
              className={`${inputCls} font-mono uppercase`}
              placeholder="HDFCN12345678901"
            />
            <p className="text-[10px] text-gray-400 mt-1">Mandatory. Letters and digits only. Must be unique across the workspace.</p>
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Remarks (optional)</label>
            <textarea
              rows="2" value={form.remarks || ''} onChange={e => set('remarks', e.target.value)}
              className={inputCls} placeholder="e.g. Slab milestone disbursement"
            />
          </div>
          <button
            onClick={handleSave}
            disabled={submitting || !form.loanId || !form.amount || !form.disbursementDate || !form.utrNumber}
            className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Saving...' : 'Save Disbursement'}
          </button>
        </div>
      </Modal>

      {/* Floating Add Button - hidden on read-only tabs (Overview, Insights). */}
      {tab !== 'overview' && tab !== 'insights' && (
        <button
          onClick={() => {
            if (tab === 'loans') openAdd('loan', emptyLoan);
            else if (tab === 'demands') openAdd('demand', emptyDemand);
            else if (tab === 'disbursements') openAdd('disbursement', { ...emptyDisbursement, loanId: loans[0]?.id || '', disbursementDate: new Date().toISOString().slice(0, 10) });
            else openAdd('payment', emptyPayment);
          }}
          className="fixed bottom-20 right-6 z-40 p-3.5 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 active:scale-95 transition-all"
        >
          <HiPlus className="w-6 h-6" />
        </button>
      )}

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
