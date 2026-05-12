'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Keyboard, ScanLine, Loader2 } from 'lucide-react';

import { parseScan, useHidScanner, type ParsedScan } from '@/lib/scan';

type CamState = 'idle' | 'starting' | 'running' | 'denied' | 'error';

const SCANNER_ELEMENT_ID = 'agnipariksha-qr-reader';

export default function ScanPage(): React.ReactElement {
  const router = useRouter();
  const [camState, setCamState] = useState<CamState>('idle');
  const [lastScan, setLastScan] = useState<ParsedScan | null>(null);
  const [manualInput, setManualInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<unknown>(null);

  const handleScan = useCallback((parsed: ParsedScan) => {
    setLastScan(parsed);
    // Brief pause so users see the recognised payload before redirecting.
    setTimeout(() => router.push(parsed.href), 350);
  }, [router]);

  useHidScanner(handleScan, { enabled: true });

  const startCamera = useCallback(async () => {
    setError(null);
    setCamState('starting');
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded: string) => {
          // Stop after the first read so we don't fire the redirect twice.
          scanner.stop().catch(() => {});
          handleScan(parseScan(decoded));
        },
        () => { /* per-frame scan failures are normal — ignore */ },
      );
      setCamState('running');
    } catch (e) {
      const msg = (e as Error)?.message ?? 'camera failed';
      if (/permission|denied|NotAllowed/i.test(msg)) setCamState('denied');
      else setCamState('error');
      setError(msg);
    }
  }, [handleScan]);

  useEffect(() => () => {
    const s = scannerRef.current as { stop?: () => Promise<unknown> } | null;
    s?.stop?.().catch(() => {});
  }, []);

  const onManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    handleScan(parseScan(manualInput));
  };

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="space-y-1">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <ScanLine className="h-5 w-5 text-orange-400" /> Scan barcode / QR
          </h1>
          <p className="text-xs text-gray-400">
            Module, equipment, or spare-part ID. Camera or USB scanner supported.
          </p>
        </header>

        <section className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Camera className="h-4 w-4 text-blue-400" />
              <span>Camera scan</span>
            </div>
            <button
              type="button"
              onClick={startCamera}
              disabled={camState === 'starting' || camState === 'running'}
              className="inline-flex items-center gap-1.5 rounded bg-blue-700/70 px-3 py-1.5 text-xs font-semibold text-blue-50 hover:bg-blue-700 disabled:opacity-60"
            >
              {camState === 'starting' && <Loader2 className="h-3 w-3 animate-spin" />}
              {camState === 'running' ? 'Scanning…' : camState === 'starting' ? 'Starting' : 'Start camera'}
            </button>
          </div>
          <div
            id={SCANNER_ELEMENT_ID}
            className="mt-3 aspect-square w-full overflow-hidden rounded bg-black/60"
          />
          {error && (
            <p className="mt-2 text-xs text-red-300" role="alert">
              {camState === 'denied'
                ? 'Camera permission denied — use the manual input below.'
                : error}
            </p>
          )}
        </section>

        <section className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
          <div className="flex items-center gap-2 text-sm">
            <Keyboard className="h-4 w-4 text-emerald-400" />
            <span>USB / HID scanner</span>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Most USB scanners type the payload then send Enter. Just scan with this page focused — no input needed.
          </p>
          <form onSubmit={onManualSubmit} className="mt-3 flex gap-2">
            <input
              type="text"
              autoFocus
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="MOD-001234, EQP-PV6000-1, SPR-FUSE-15A …"
              className="flex-1 rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm font-mono"
              aria-label="Scan payload"
            />
            <button
              type="submit"
              className="rounded bg-emerald-700/80 px-3 py-2 text-xs font-semibold hover:bg-emerald-700"
            >
              Go
            </button>
          </form>
        </section>

        {lastScan && (
          <div
            role="status"
            className="rounded border border-emerald-700/60 bg-emerald-900/30 p-3 text-sm text-emerald-100"
          >
            <div className="font-semibold">Detected {lastScan.kind}</div>
            <div className="font-mono text-xs text-emerald-200/80">{lastScan.raw}</div>
            <div className="text-xs text-emerald-200/70">Opening {lastScan.href} …</div>
          </div>
        )}
      </div>
    </main>
  );
}
