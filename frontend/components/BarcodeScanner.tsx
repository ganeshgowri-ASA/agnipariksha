'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface BarcodeScannerProps {
  open: boolean;
  onClose: () => void;
  onScan: (decoded: string) => void;
}

interface Html5QrcodeError {
  errorMessage?: string;
  type?: number;
}

interface Html5QrcodeScannerInstance {
  render: (
    onSuccess: (decodedText: string) => void,
    onFailure?: (errorMessage: string, error: Html5QrcodeError) => void,
  ) => void;
  clear: () => Promise<void>;
}

interface Html5QrcodeScannerCtor {
  new (
    elementId: string,
    config: {
      fps?: number;
      qrbox?: number | { width: number; height: number };
      rememberLastUsedCamera?: boolean;
      supportedScanTypes?: number[];
      formatsToSupport?: number[];
    },
    verbose?: boolean,
  ): Html5QrcodeScannerInstance;
}

export default function BarcodeScanner({ open, onClose, onScan }: BarcodeScannerProps) {
  const containerId = `barcode-scanner-${useId().replace(/:/g, '')}`;
  const scannerRef = useRef<Html5QrcodeScannerInstance | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function start() {
      try {
        const mod = (await import('html5-qrcode')) as unknown as {
          Html5QrcodeScanner?: Html5QrcodeScannerCtor;
          default?: { Html5QrcodeScanner?: Html5QrcodeScannerCtor };
        };
        const Ctor = mod.Html5QrcodeScanner ?? mod.default?.Html5QrcodeScanner;
        if (!Ctor) throw new Error('Html5QrcodeScanner not found in module');
        if (cancelled) return;
        const scanner = new Ctor(
          containerId,
          {
            fps: 10,
            qrbox: { width: 260, height: 160 },
            rememberLastUsedCamera: true,
          },
          false,
        );
        scanner.render(
          (decoded) => {
            onScan(decoded);
            void scanner.clear().catch(() => undefined);
            scannerRef.current = null;
            onClose();
          },
          // Per-frame scan failures are noisy; ignore them.
          () => undefined,
        );
        scannerRef.current = scanner;
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Failed to load scanner');
        }
      }
    }

    void start();

    return () => {
      cancelled = true;
      if (scannerRef.current) {
        void scannerRef.current.clear().catch(() => undefined);
        scannerRef.current = null;
      }
    };
  }, [open, containerId, onClose, onScan]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Barcode scanner"
      data-testid="barcode-scanner-dialog"
    >
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-md p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-orange-400">Scan module barcode</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white"
            aria-label="Close scanner"
            data-testid="barcode-scanner-close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loadError ? (
          <div className="bg-red-900/30 border border-red-700/40 rounded p-3 text-xs text-red-300">
            ❌ {loadError}. Make sure the page is served over HTTPS or localhost
            and the browser has camera permission.
          </div>
        ) : (
          <p className="text-[11px] text-gray-400">
            Point the camera at a 1D barcode (Code 128, EAN, UPC) or QR code on the
            PV module nameplate.
          </p>
        )}

        <div id={containerId} className="w-full" />
      </div>
    </div>
  );
}
