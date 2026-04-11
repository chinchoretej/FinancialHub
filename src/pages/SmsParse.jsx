import { useState } from 'react';
import { useCollection } from '../hooks/useFirestore';
import Card from '../components/Card';
import { format } from 'date-fns';

const PATTERNS = {
  amount: [
    /(?:Rs\.?|INR|₹)\s?([\d,]+(?:\.\d{2})?)/i,
    /(?:amount|amt|debited|credited|paid|received)\s*(?:of\s*)?(?:Rs\.?|INR|₹)?\s?([\d,]+(?:\.\d{2})?)/i,
  ],
  date: [
    /(\d{2}[/-]\d{2}[/-]\d{2,4})/,
    /(\d{2}-[A-Za-z]{3}-\d{2,4})/,
  ],
  ref: [
    /(?:ref\.?\s*(?:no\.?\s*)?|txn\s*(?:id\s*)?|utr\s*(?:no\.?\s*)?|transaction\s*id\s*):?\s*([A-Za-z0-9]+)/i,
    /([A-Z0-9]{12,})/,
  ],
};

function parseSms(text) {
  let amount = null;
  for (const p of PATTERNS.amount) {
    const m = text.match(p);
    if (m) { amount = m[1].replace(/,/g, ''); break; }
  }

  let date = null;
  for (const p of PATTERNS.date) {
    const m = text.match(p);
    if (m) { date = m[1]; break; }
  }

  let ref = null;
  for (const p of PATTERNS.ref) {
    const m = text.match(p);
    if (m) { ref = m[1]; break; }
  }

  const isDebit = /debit|debited|spent|paid|purchase|withdrawn/i.test(text);
  const isCredit = /credit|credited|received|refund|cashback/i.test(text);

  return { amount, date, ref, type: isDebit ? 'expense' : isCredit ? 'income' : 'unknown' };
}

export default function SmsParse() {
  const [smsText, setSmsText] = useState('');
  const [parsed, setParsed] = useState(null);
  const { add: addExpense } = useCollection('expenses', 'date');
  const { add: addPayment } = useCollection('payments', 'createdAt');
  const [saved, setSaved] = useState(false);

  const handleParse = () => {
    if (!smsText.trim()) return;
    setParsed(parseSms(smsText));
    setSaved(false);
  };

  const handleSaveAsExpense = async () => {
    if (!parsed?.amount) return;
    await addExpense({
      date: format(new Date(), 'yyyy-MM-dd'),
      category: 'Other',
      amount: parsed.amount,
      paymentMode: 'UPI',
      notes: `SMS parsed: ${smsText.slice(0, 100)}`,
    });
    setSaved(true);
  };

  const handleSaveAsPayment = async () => {
    if (!parsed?.amount) return;
    await addPayment({
      demandId: '',
      paymentDate: format(new Date(), 'yyyy-MM-dd'),
      paidBy: 'Self',
      amountPaid: parsed.amount,
      gstPaid: '0',
      totalPaid: Number(parsed.amount),
      transactionRef: parsed.ref || '',
      outstandingAmount: 0,
    });
    setSaved(true);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">SMS Parser</h2>

      <Card>
        <label className="block text-sm text-gray-600 mb-2">Paste SMS text below</label>
        <textarea
          value={smsText}
          onChange={e => setSmsText(e.target.value)}
          rows={5}
          placeholder="e.g. Your A/c XX1234 debited by Rs.500.00 on 10-Apr-26. Ref No: UPI123456789..."
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
        />
        <button onClick={handleParse}
          className="mt-3 w-full py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors">
          Parse SMS
        </button>
      </Card>

      {parsed && (
        <Card>
          <h3 className="text-sm font-semibold mb-3">Parsed Result</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Amount</span>
              <span className="font-medium">{parsed.amount ? `₹${Number(parsed.amount).toLocaleString('en-IN')}` : 'Not found'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Date</span>
              <span className="font-medium">{parsed.date || 'Not found'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Reference</span>
              <span className="font-medium">{parsed.ref || 'Not found'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Type</span>
              <span className={`font-medium ${parsed.type === 'expense' ? 'text-red-600' : parsed.type === 'income' ? 'text-green-600' : 'text-gray-600'}`}>
                {parsed.type === 'expense' ? 'Debit' : parsed.type === 'income' ? 'Credit' : 'Unknown'}
              </span>
            </div>
          </div>

          {parsed.amount && !saved && (
            <div className="flex gap-2 mt-4">
              <button onClick={handleSaveAsExpense}
                className="flex-1 py-2 bg-red-50 text-red-600 rounded-xl text-sm font-medium hover:bg-red-100 transition-colors">
                Save as Expense
              </button>
              <button onClick={handleSaveAsPayment}
                className="flex-1 py-2 bg-green-50 text-green-600 rounded-xl text-sm font-medium hover:bg-green-100 transition-colors">
                Save as Payment
              </button>
            </div>
          )}

          {saved && (
            <div className="mt-4 p-3 bg-green-50 text-green-700 rounded-xl text-sm text-center">
              Saved successfully!
            </div>
          )}
        </Card>
      )}

      <Card>
        <h3 className="text-sm font-semibold mb-2">Supported SMS Formats</h3>
        <ul className="text-xs text-gray-500 space-y-1">
          <li>Bank debit/credit alerts (SBI, HDFC, ICICI, etc.)</li>
          <li>UPI payment confirmations</li>
          <li>Credit card transaction alerts</li>
          <li>Any SMS with amount in Rs./INR/₹ format</li>
        </ul>
      </Card>
    </div>
  );
}
