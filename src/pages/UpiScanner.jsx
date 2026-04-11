import { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import Card from '../components/Card';
import { HiOutlineQrCode, HiCamera, HiStop, HiArrowTopRightOnSquare } from 'react-icons/hi2';

function parseUpiUrl(url) {
  try {
    if (!url.toLowerCase().startsWith('upi://')) return null;
    const params = new URLSearchParams(url.split('?')[1] || '');
    return {
      pa: params.get('pa') || '',
      pn: params.get('pn') || '',
      am: params.get('am') || '',
      tn: params.get('tn') || '',
      cu: params.get('cu') || 'INR',
      raw: url,
    };
  } catch {
    return null;
  }
}

export default function UpiScanner() {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const scannerRef = useRef(null);
  const containerRef = useRef(null);

  const startScanner = async () => {
    setError('');
    setResult(null);

    try {
      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (text) => {
          const upi = parseUpiUrl(text);
          if (upi) {
            setResult(upi);
          } else {
            setResult({ raw: text, pa: '', pn: '', am: '', tn: '', cu: '' });
          }
          scanner.stop().catch(() => {});
          setScanning(false);
        },
        () => {}
      );
      setScanning(true);
    } catch (err) {
      setError(err?.message || 'Camera access denied or not available');
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch {}
      scannerRef.current = null;
    }
    setScanning(false);
  };

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  const upiPayUrl = result?.pa
    ? `upi://pay?pa=${encodeURIComponent(result.pa)}&pn=${encodeURIComponent(result.pn || '')}&am=${encodeURIComponent(result.am || '')}&cu=INR`
    : null;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold dark:text-white">UPI Scanner</h2>

      <Card>
        <div className="text-center space-y-3">
          <div
            id="qr-reader"
            className="mx-auto rounded-xl overflow-hidden"
            style={{ maxWidth: 350, display: scanning ? 'block' : 'none' }}
          />

          {!scanning && !result && (
            <div className="py-8 space-y-4">
              <HiOutlineQrCode className="w-16 h-16 mx-auto text-gray-300 dark:text-gray-500" />
              <p className="text-sm text-gray-500 dark:text-gray-400">Scan a UPI QR code to extract payment details</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm p-3 rounded-xl">{error}</div>
          )}

          <button
            onClick={scanning ? stopScanner : startScanner}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              scanning
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            }`}
          >
            {scanning ? <><HiStop className="w-4 h-4" /> Stop Scanner</> : <><HiCamera className="w-4 h-4" /> Start Scanner</>}
          </button>
        </div>
      </Card>

      {result && (
        <Card>
          <h3 className="text-sm font-semibold mb-3 dark:text-white">Scanned Result</h3>
          <div className="space-y-2 text-sm">
            {result.pa && (
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">UPI ID</span>
                <span className="font-medium dark:text-white">{result.pa}</span>
              </div>
            )}
            {result.pn && (
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Name</span>
                <span className="font-medium dark:text-white">{result.pn}</span>
              </div>
            )}
            {result.am && (
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Amount</span>
                <span className="font-medium dark:text-white">₹{Number(result.am).toLocaleString('en-IN')}</span>
              </div>
            )}
            {result.tn && (
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Note</span>
                <span className="font-medium dark:text-white">{result.tn}</span>
              </div>
            )}
            {!result.pa && (
              <div>
                <span className="text-gray-500 dark:text-gray-400 text-xs break-all">Raw: {result.raw}</span>
              </div>
            )}
          </div>

          {upiPayUrl && (
            <a
              href={upiPayUrl}
              className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 transition-colors"
            >
              <HiArrowTopRightOnSquare className="w-4 h-4" /> Pay via UPI App
            </a>
          )}

          <button
            onClick={() => { setResult(null); setError(''); }}
            className="mt-2 w-full py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            Scan Again
          </button>
        </Card>
      )}

      <Card>
        <h3 className="text-sm font-semibold mb-2 dark:text-white">How it works</h3>
        <ul className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
          <li>Point your camera at any UPI QR code</li>
          <li>The app extracts UPI ID, name, and amount</li>
          <li>Tap "Pay via UPI App" to open your payment app</li>
          <li>Works with PhonePe, GPay, Paytm, and other UPI apps</li>
        </ul>
      </Card>
    </div>
  );
}
