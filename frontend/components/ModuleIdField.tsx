'use client';

import { useEffect, useState } from 'react';
import { ScanBarcode, CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react';
import BarcodeScanner from './BarcodeScanner';
import { useModuleStore } from '@/lib/module-store';

interface ModuleIdFieldProps {
  /**
   * Accent colour for the section header. Each test tab passes its own
   * standard colour (e.g. text-orange-400 for TC) so the panel blends in.
   */
  accentColor?: string;
  /** Optional label override; defaults to "Module under test". */
  label?: string;
}

export default function ModuleIdField({
  accentColor = 'text-gray-200',
  label = 'Module under test',
}: ModuleIdFieldProps) {
  const moduleId = useModuleStore((s) => s.moduleId);
  const validation = useModuleStore((s) => s.validation);
  const message = useModuleStore((s) => s.validationMessage);
  const nameplate = useModuleStore((s) => s.nameplate);
  const setModuleId = useModuleStore((s) => s.setModuleId);
  const validate = useModuleStore((s) => s.validate);
  const clear = useModuleStore((s) => s.clear);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [draft, setDraft] = useState(moduleId);

  // Keep the local draft in sync when other tabs / the scanner update the
  // shared store. This lets the operator scan in TC and see the same ID
  // already filled in HF / DH / etc.
  useEffect(() => {
    setDraft(moduleId);
  }, [moduleId]);

  const handleApply = (id: string, source: 'manual' | 'paste' | 'scan') => {
    setModuleId(id, source);
    if (id.trim()) void validate(id);
  };

  const handleScan = (decoded: string) => {
    setDraft(decoded);
    handleApply(decoded, 'scan');
  };

  const handlePaste = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) return;
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      if (!trimmed) return;
      setDraft(trimmed);
      handleApply(trimmed, 'paste');
    } catch {
      /* clipboard read denied; user can still type the ID */
    }
  };

  return (
    <div
      className="bg-gray-900 rounded-lg border border-gray-700 p-4 space-y-3"
      data-testid="module-id-field"
    >
      <div className="flex items-center justify-between">
        <h3 className={`text-sm font-bold ${accentColor}`}>{label}</h3>
        {moduleId && (
          <button
            type="button"
            onClick={clear}
            className="text-[10px] text-gray-500 hover:text-gray-300 inline-flex items-center gap-1"
            data-testid="module-id-clear"
          >
            <X className="w-3 h-3" /> Clear
          </button>
        )}
      </div>

      <p className="text-xs text-gray-400">
        Scan the module's serial barcode, paste from the clipboard, or type the ID
        manually. The value is shared across every IEC test tab and the report.
      </p>

      <div className="flex gap-2 items-stretch">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== moduleId) handleApply(draft, 'manual');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleApply(draft, 'manual');
            }
          }}
          placeholder="e.g. MOD-2026-001 or scan barcode"
          aria-label="Module ID"
          data-testid="module-id-input"
          className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-orange-500"
        />
        <button
          type="button"
          onClick={() => setScannerOpen(true)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-orange-700 hover:bg-orange-600 text-white rounded font-medium transition-colors"
          data-testid="module-id-scan"
        >
          <ScanBarcode className="w-3.5 h-3.5" />
          Scan
        </button>
        <button
          type="button"
          onClick={handlePaste}
          className="px-2.5 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded font-medium transition-colors"
          data-testid="module-id-paste"
        >
          Paste
        </button>
      </div>

      <StatusLine status={validation} message={message} />

      {nameplate && validation === 'valid' && (
        <dl
          className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] bg-gray-800/60 rounded p-2.5 border border-gray-700"
          data-testid="module-nameplate"
        >
          {nameplate.manufacturer && (
            <Row label="Manufacturer" value={nameplate.manufacturer} />
          )}
          {nameplate.model && <Row label="Model" value={nameplate.model} />}
          {nameplate.pmax_w != null && (
            <Row label="Pmax" value={`${nameplate.pmax_w} W`} />
          )}
          {nameplate.voc_v != null && <Row label="Voc" value={`${nameplate.voc_v} V`} />}
          {nameplate.isc_a != null && <Row label="Isc" value={`${nameplate.isc_a} A`} />}
          {nameplate.vmpp_v != null && (
            <Row label="Vmpp" value={`${nameplate.vmpp_v} V`} />
          )}
          {nameplate.impp_a != null && (
            <Row label="Impp" value={`${nameplate.impp_a} A`} />
          )}
        </dl>
      )}

      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleScan}
      />
    </div>
  );
}

function StatusLine({
  status,
  message,
}: {
  status: 'idle' | 'validating' | 'valid' | 'invalid' | 'error';
  message: string;
}) {
  if (status === 'idle') return null;
  const palette = {
    validating: 'text-blue-400',
    valid: 'text-green-400',
    invalid: 'text-red-400',
    error: 'text-yellow-400',
  }[status];
  const Icon =
    status === 'validating'
      ? Loader2
      : status === 'valid'
        ? CheckCircle2
        : AlertCircle;
  return (
    <div
      className={`flex items-center gap-1.5 text-[11px] ${palette}`}
      data-testid={`module-id-status-${status}`}
      role="status"
    >
      <Icon className={`w-3.5 h-3.5 ${status === 'validating' ? 'animate-spin' : ''}`} />
      <span>{message}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-200 font-mono">{value}</dd>
    </>
  );
}
