import { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import Card from '../components/Card';
import { HiOutlineQrCode, HiCamera, HiXMark, HiArrowTopRightOnSquare } from 'react-icons/hi2';

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

function ScannerOverlay() {
  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      <div className="absolute inset-0">
        <div className="absolute top-0 left-0 right-0 h-[calc(50%-110px)] bg-black/50" />
        <div className="absolute bottom-0 left-0 right-0 h-[calc(50%-110px)] bg-black/50" />
        <div className="absolute top-[calc(50%-110px)] left-0 w-[calc(50%-110px)] h-[220px] bg-black/50" />
        <div className="absolute top-[calc(50%-110px)] right-0 w-[calc(50%-110px)] h-[220px] bg-black/50" />
      </div>

      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[220px] h-[220px]">
        <div className="absolute top-0 left-0 w-8 h-8 border-t-[3px] border-l-[3px] border-indigo-400 rounded-tl-lg" />
        <div className="absolute top-0 right-0 w-8 h-8 border-t-[3px] border-r-[3px] border-indigo-400 rounded-tr-lg" />
        <div className="absolute bottom-0 left-0 w-8 h-8 border-b-[3px] border-l-[3px] border-indigo-400 rounded-bl-lg" />
        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-[3px] border-r-[3px] border-indigo-400 rounded-br-lg" />

        <div className="absolute left-2 right-2 h-[2px] animate-scanner-line">
          <div className="h-full bg-gradient-to-r from-transparent via-indigo-400 to-transparent" />
        </div>
      </div>

      <div className="absolute bottom-6 left-0 right-0 text-center">
        <p className="text-white/80 text-xs font-medium drop-shadow">Point camera at a QR code</p>
      </div>
    </div>
  );
}

export default function UpiScanner() {
  const [showScanner, setShowScanner] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const scannerRef = useRef(null);
  const mountedRef = useRef(false);

  const initScanner = useCallback(async () => {
    const el = document.getElementById('qr-reader');
    if (!el || scannerRef.current) return;

    try {
      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 }, disableFlip: false },
        (text) => {
          const upi = parseUpiUrl(text);
          setResult(upi || { raw: text, pa: '', pn: '', am: '', tn: '', cu: '' });
          scanner.stop().catch(() => {});
          scannerRef.current = null;
          setShowScanner(false);
          setCameraReady(false);
        },
        () => {}
      );
      setCameraReady(true);
    } catch (err) {
      setError(err?.message || 'Camera access denied or not available');
      setShowScanner(false);
      setCameraReady(false);
    }
  }, []);

  useEffect(() => {
    if (showScanner && !scannerRef.current) {
      const timer = setTimeout(initScanner, 100);
      return () => clearTimeout(timer);
    }
  }, [showScanner, initScanner]);

  const openScanner = () => {
    setError('');
    setResult(null);
    setCameraReady(false);
    setShowScanner(true);
  };

  const closeScanner = async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch {}
      scannerRef.current = null;
    }
    setShowScanner(false);
    setCameraReady(false);
  };

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, []);

  const upiPayUrl = result?.pa
    ? `upi://pay?pa=${encodeURIComponent(result.pa)}&pn=${encodeURIComponent(result.pn || '')}&am=${encodeURIComponent(result.am || '')}&cu=INR`
    : null;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold dark:text-white">UPI Scanner</h2>

      {showScanner && (
        <div className="fixed inset-0 z-50 bg-black">
          <div id="qr-reader" className="absolute inset-0" />

          {!cameraReady && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center">
              <div className="w-8 h-8 border-4 border-white/20 border-t-white rounded-full animate-spin mb-3" />
              <p className="text-white/70 text-sm">Starting camera...</p>
            </div>
          )}

          {cameraReady && <ScannerOverlay />}

          <button
            onClick={closeScanner}
            className="absolute top-4 right-4 z-20 p-2.5 bg-black/50 backdrop-blur-sm rounded-full text-white hover:bg-black/70 transition-colors"
          >
            <HiXMark className="w-6 h-6" />
          </button>
        </div>
      )}

      {!result && !showScanner && (
        <Card>
          <div className="text-center py-6 space-y-5">
            <div className="relative w-24 h-24 mx-auto">
              <div className="absolute inset-0 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-600" />
              <HiOutlineQrCode className="w-12 h-12 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-gray-300 dark:text-gray-500" />
            </div>
            <div>
              <p className="text-sm font-medium dark:text-white">Scan QR Code</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Point your camera at a UPI QR code to pay</p>
            </div>
            <button
              onClick={openScanner}
              className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              <HiCamera className="w-5 h-5" /> Open Scanner
            </button>
          </div>
        </Card>
      )}

      {error && (
        <Card className="!bg-red-50 !border-red-200 dark:!bg-red-900/30 dark:!border-red-800">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <button
            onClick={() => setError('')}
            className="mt-2 text-xs text-red-500 underline"
          >
            Dismiss
          </button>
        </Card>
      )}

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
            onClick={openScanner}
            className="mt-2 w-full py-2.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
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
