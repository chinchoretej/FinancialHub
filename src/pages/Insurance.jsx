import { useState, useMemo, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useCollection } from '../hooks/useFirestore';
import Card from '../components/Card';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { HiOutlineShieldCheck, HiPlus, HiTrash, HiPencil, HiEye, HiEyeSlash, HiLockClosed } from 'react-icons/hi2';

const POLICY_TYPES = ['LIC', 'Term Life', 'Health', 'Vehicle', 'Home', 'Travel', 'Child Plan', 'Pension/Annuity', 'Other'];
const PREMIUM_FREQ = ['Monthly', 'Quarterly', 'Half-Yearly', 'Yearly', 'One-Time'];

const emptyPolicy = {
  policyName: '', type: 'LIC', policyNumber: '', provider: '',
  sumAssured: '', premiumAmount: '', premiumFrequency: 'Yearly',
  premiumDueDate: '', startDate: '', maturityDate: '',
  nomineeName: '', nomineeRelation: '', nomineePhone: '',
  agentName: '', agentPhone: '',
  notes: '',
};

const PIN_DOC = 'insurancePin';
const SETTINGS_COL = 'settings';

export default function Insurance() {
  const { user } = useAuth();
  const { data: policies, add, update, remove } = useCollection('insurance', 'createdAt');

  const [pinHash, setPinHash] = useState(null);
  const [pinLoading, setPinLoading] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [isSettingPin, setIsSettingPin] = useState(false);
  const [confirmPin, setConfirmPin] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyPolicy);
  const [viewPolicy, setViewPolicy] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [showChangePinModal, setShowChangePinModal] = useState(false);
  const [oldPinInput, setOldPinInput] = useState('');
  const [newPinInput, setNewPinInput] = useState('');
  const [newPinConfirm, setNewPinConfirm] = useState('');
  const [changePinError, setChangePinError] = useState('');

  const simpleHash = useCallback((str) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + ch;
      hash |= 0;
    }
    return 'h_' + Math.abs(hash).toString(36);
  }, []);

  useEffect(() => {
    const ref = doc(db, SETTINGS_COL, PIN_DOC);
    getDoc(ref).then(snap => {
      if (snap.exists()) setPinHash(snap.data().hash);
      else setIsSettingPin(true);
      setPinLoading(false);
    }).catch(() => setPinLoading(false));
  }, []);

  const handleSetPin = async () => {
    if (pinInput.length < 4) { setPinError('PIN must be at least 4 digits'); return; }
    if (pinInput !== confirmPin) { setPinError('PINs do not match'); return; }
    const hash = simpleHash(pinInput);
    await setDoc(doc(db, SETTINGS_COL, PIN_DOC), { hash });
    setPinHash(hash);
    setIsSettingPin(false);
    setUnlocked(true);
    setPinInput('');
    setConfirmPin('');
    setPinError('');
  };

  const handleUnlock = () => {
    if (simpleHash(pinInput) === pinHash) {
      setUnlocked(true);
      setPinInput('');
      setPinError('');
    } else {
      setPinError('Incorrect PIN');
      setPinInput('');
    }
  };

  const handleChangePin = async () => {
    if (simpleHash(oldPinInput) !== pinHash) { setChangePinError('Current PIN is incorrect'); return; }
    if (newPinInput.length < 4) { setChangePinError('New PIN must be at least 4 digits'); return; }
    if (newPinInput !== newPinConfirm) { setChangePinError('New PINs do not match'); return; }
    const hash = simpleHash(newPinInput);
    await setDoc(doc(db, SETTINGS_COL, PIN_DOC), { hash });
    setPinHash(hash);
    setShowChangePinModal(false);
    setOldPinInput('');
    setNewPinInput('');
    setNewPinConfirm('');
    setChangePinError('');
  };

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));
  const fmt = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

  const openAdd = () => { setForm(emptyPolicy); setEditId(null); setShowModal(true); };
  const openEdit = (p) => {
    setForm({
      policyName: p.policyName || '', type: p.type || 'LIC', policyNumber: p.policyNumber || '',
      provider: p.provider || '', sumAssured: p.sumAssured || '', premiumAmount: p.premiumAmount || '',
      premiumFrequency: p.premiumFrequency || 'Yearly', premiumDueDate: p.premiumDueDate || '',
      startDate: p.startDate || '', maturityDate: p.maturityDate || '',
      nomineeName: p.nomineeName || '', nomineeRelation: p.nomineeRelation || '', nomineePhone: p.nomineePhone || '',
      agentName: p.agentName || '', agentPhone: p.agentPhone || '', notes: p.notes || '',
    });
    setEditId(p.id);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.policyName || !form.policyNumber) return;
    if (editId) await update(editId, form);
    else await add(form);
    setForm(emptyPolicy);
    setEditId(null);
    setShowModal(false);
  };

  const totalPremiumYearly = useMemo(() => {
    return policies.reduce((sum, p) => {
      const amt = Number(p.premiumAmount) || 0;
      const freq = p.premiumFrequency;
      if (freq === 'Monthly') return sum + amt * 12;
      if (freq === 'Quarterly') return sum + amt * 4;
      if (freq === 'Half-Yearly') return sum + amt * 2;
      if (freq === 'One-Time') return sum;
      return sum + amt;
    }, 0);
  }, [policies]);

  const totalSumAssured = useMemo(() => policies.reduce((s, p) => s + (Number(p.sumAssured) || 0), 0), [policies]);

  if (pinLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (isSettingPin) {
    return (
      <div className="max-w-xs mx-auto py-12 space-y-5 text-center">
        <div className="w-16 h-16 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center mx-auto">
          <HiLockClosed className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold dark:text-white">Set Up Insurance PIN</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">This PIN protects your policy details. Share it only with trusted family.</p>
        </div>
        <div className="space-y-3">
          <input
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pinInput}
            onChange={e => { setPinInput(e.target.value.replace(/\D/g, '')); setPinError(''); }}
            placeholder="Enter PIN (min 4 digits)"
            className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl text-center text-lg tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
          />
          <input
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={confirmPin}
            onChange={e => { setConfirmPin(e.target.value.replace(/\D/g, '')); setPinError(''); }}
            placeholder="Confirm PIN"
            className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl text-center text-lg tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
          />
          {pinError && <p className="text-xs text-red-500">{pinError}</p>}
          <button onClick={handleSetPin} className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors">
            Set PIN
          </button>
        </div>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="max-w-xs mx-auto py-12 space-y-5 text-center">
        <div className="w-16 h-16 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center mx-auto">
          <HiLockClosed className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold dark:text-white">Insurance Vault</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Enter your PIN to view policy details</p>
        </div>
        <div className="space-y-3">
          <input
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pinInput}
            onChange={e => { setPinInput(e.target.value.replace(/\D/g, '')); setPinError(''); }}
            onKeyDown={e => e.key === 'Enter' && handleUnlock()}
            placeholder="Enter PIN"
            autoFocus
            className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl text-center text-lg tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
          />
          {pinError && <p className="text-xs text-red-500">{pinError}</p>}
          <button onClick={handleUnlock} className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors">
            Unlock
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold dark:text-white flex items-center gap-2">
          <HiOutlineShieldCheck className="w-6 h-6 text-indigo-500" /> Insurance
        </h2>
        <div className="flex gap-2">
          <button onClick={() => setShowChangePinModal(true)} className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300 transition-colors">
            Change PIN
          </button>
          <button onClick={openAdd} className="flex items-center gap-1 px-3 py-2 bg-indigo-600 text-white text-sm rounded-xl hover:bg-indigo-700 transition-colors">
            <HiPlus className="w-4 h-4" /> Add Policy
          </button>
        </div>
      </div>

      {policies.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total Cover</p>
            <p className="text-lg font-bold text-indigo-600">{fmt(totalSumAssured)}</p>
          </Card>
          <Card>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Yearly Premium</p>
            <p className="text-lg font-bold text-amber-600">{fmt(totalPremiumYearly)}</p>
          </Card>
        </div>
      )}

      {policies.length === 0 ? (
        <EmptyState icon={HiOutlineShieldCheck} message="No policies added yet" />
      ) : (
        <div className="space-y-2">
          {policies.map(p => (
            <Card key={p.id} className="!p-3">
              <div className="flex items-start gap-3">
                <div className="shrink-0 w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center">
                  <HiOutlineShieldCheck className="w-5 h-5 text-indigo-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium dark:text-white">{p.policyName}</span>
                    <span className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300 rounded-full">{p.type}</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">{p.provider} &middot; {p.policyNumber}</div>
                  <div className="flex items-center gap-3 mt-1 text-xs">
                    <span className="text-gray-500 dark:text-gray-400">Cover: <span className="font-medium text-gray-700 dark:text-gray-200">{fmt(p.sumAssured)}</span></span>
                    <span className="text-gray-500 dark:text-gray-400">Premium: <span className="font-medium text-gray-700 dark:text-gray-200">{fmt(p.premiumAmount)}/{p.premiumFrequency?.charAt(0)}</span></span>
                  </div>
                </div>
                <div className="flex gap-0.5 shrink-0">
                  <button onClick={() => setViewPolicy(p)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg" title="View details">
                    <HiEye className="w-4 h-4 text-gray-400" />
                  </button>
                  <button onClick={() => openEdit(p)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg" title="Edit">
                    <HiPencil className="w-4 h-4 text-gray-400" />
                  </button>
                  <button onClick={() => setConfirmDelete(p)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg" title="Delete">
                    <HiTrash className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add / Edit Policy */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editId ? 'Edit Policy' : 'Add Policy'}>
        <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
          <SectionLabel text="Policy Info" />
          <FormInput label="Policy Name *" value={form.policyName} onChange={v => set('policyName', v)} placeholder="e.g. Jeevan Anand 815" />
          <div className="grid grid-cols-2 gap-3">
            <FormSelect label="Type" value={form.type} onChange={v => set('type', v)} options={POLICY_TYPES} />
            <FormInput label="Policy Number *" value={form.policyNumber} onChange={v => set('policyNumber', v)} placeholder="e.g. 12345678" />
          </div>
          <FormInput label="Insurance Provider" value={form.provider} onChange={v => set('provider', v)} placeholder="e.g. LIC of India" />

          <SectionLabel text="Financial" />
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Sum Assured" type="number" value={form.sumAssured} onChange={v => set('sumAssured', v)} />
            <FormInput label="Premium Amount" type="number" value={form.premiumAmount} onChange={v => set('premiumAmount', v)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormSelect label="Premium Frequency" value={form.premiumFrequency} onChange={v => set('premiumFrequency', v)} options={PREMIUM_FREQ} />
            <FormInput label="Premium Due Date" value={form.premiumDueDate} onChange={v => set('premiumDueDate', v)} placeholder="e.g. 15th March" />
          </div>

          <SectionLabel text="Dates" />
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Start Date" type="date" value={form.startDate} onChange={v => set('startDate', v)} />
            <FormInput label="Maturity Date" type="date" value={form.maturityDate} onChange={v => set('maturityDate', v)} />
          </div>

          <SectionLabel text="Nominee" />
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Nominee Name" value={form.nomineeName} onChange={v => set('nomineeName', v)} />
            <FormInput label="Relation" value={form.nomineeRelation} onChange={v => set('nomineeRelation', v)} placeholder="e.g. Wife, Son" />
          </div>
          <FormInput label="Nominee Phone" value={form.nomineePhone} onChange={v => set('nomineePhone', v)} placeholder="Mobile number" />

          <SectionLabel text="Agent" />
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Agent Name" value={form.agentName} onChange={v => set('agentName', v)} />
            <FormInput label="Agent Phone" value={form.agentPhone} onChange={v => set('agentPhone', v)} />
          </div>

          <SectionLabel text="Additional" />
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} placeholder="Any extra details..."
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white resize-none" />
          </div>
        </div>
        <button onClick={handleSave} className="w-full mt-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors">
          {editId ? 'Update Policy' : 'Save Policy'}
        </button>
      </Modal>

      {/* View Policy Details */}
      <Modal open={!!viewPolicy} onClose={() => setViewPolicy(null)} title={viewPolicy?.policyName || 'Policy Details'}>
        {viewPolicy && (
          <div className="space-y-4 text-sm">
            <DetailSection title="Policy Info">
              <DetailRow label="Type" value={viewPolicy.type} />
              <DetailRow label="Policy Number" value={viewPolicy.policyNumber} highlight />
              <DetailRow label="Provider" value={viewPolicy.provider} />
            </DetailSection>
            <DetailSection title="Financial">
              <DetailRow label="Sum Assured" value={fmt(viewPolicy.sumAssured)} />
              <DetailRow label="Premium" value={`${fmt(viewPolicy.premiumAmount)} / ${viewPolicy.premiumFrequency}`} />
              <DetailRow label="Premium Due" value={viewPolicy.premiumDueDate} />
            </DetailSection>
            <DetailSection title="Dates">
              <DetailRow label="Start Date" value={viewPolicy.startDate} />
              <DetailRow label="Maturity Date" value={viewPolicy.maturityDate} />
            </DetailSection>
            <DetailSection title="Nominee">
              <DetailRow label="Name" value={viewPolicy.nomineeName} highlight />
              <DetailRow label="Relation" value={viewPolicy.nomineeRelation} />
              <DetailRow label="Phone" value={viewPolicy.nomineePhone} />
            </DetailSection>
            <DetailSection title="Agent">
              <DetailRow label="Name" value={viewPolicy.agentName} />
              <DetailRow label="Phone" value={viewPolicy.agentPhone} />
            </DetailSection>
            {viewPolicy.notes && (
              <DetailSection title="Notes">
                <p className="text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{viewPolicy.notes}</p>
              </DetailSection>
            )}
          </div>
        )}
      </Modal>

      {/* Change PIN */}
      <Modal open={showChangePinModal} onClose={() => { setShowChangePinModal(false); setChangePinError(''); }} title="Change PIN">
        <div className="space-y-3">
          <input type="password" inputMode="numeric" maxLength={8} value={oldPinInput}
            onChange={e => { setOldPinInput(e.target.value.replace(/\D/g, '')); setChangePinError(''); }}
            placeholder="Current PIN"
            className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl text-center text-lg tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white" />
          <input type="password" inputMode="numeric" maxLength={8} value={newPinInput}
            onChange={e => { setNewPinInput(e.target.value.replace(/\D/g, '')); setChangePinError(''); }}
            placeholder="New PIN (min 4 digits)"
            className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl text-center text-lg tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white" />
          <input type="password" inputMode="numeric" maxLength={8} value={newPinConfirm}
            onChange={e => { setNewPinConfirm(e.target.value.replace(/\D/g, '')); setChangePinError(''); }}
            placeholder="Confirm New PIN"
            className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl text-center text-lg tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white" />
          {changePinError && <p className="text-xs text-red-500 text-center">{changePinError}</p>}
          <button onClick={handleChangePin} className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors">
            Update PIN
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Policy?"
        message={`Are you sure you want to delete "${confirmDelete?.policyName}"? This cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        danger
        onConfirm={async () => { await remove(confirmDelete.id); setConfirmDelete(null); }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function SectionLabel({ text }) {
  return <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider pt-2 border-t border-gray-100 dark:border-gray-700">{text}</p>;
}

function FormInput({ label, value, onChange, type = 'text', placeholder = '' }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white" />
    </div>
  );
}

function FormSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function DetailSection({ title, children }) {
  return (
    <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
      <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function DetailRow({ label, value, highlight = false }) {
  if (!value) return null;
  return (
    <div className="flex justify-between">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`text-right ${highlight ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-200'}`}>{value}</span>
    </div>
  );
}
