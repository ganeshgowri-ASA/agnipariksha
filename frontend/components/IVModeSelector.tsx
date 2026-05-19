'use client';

/**
 * G17 — Unified IV Source selector. Module ID input + shadcn-styled
 * Select + Download Template button. Store update is keyed by Module ID;
 * template route is keyed by URL slug (`4q` / `psu-scope` / `import`).
 * This component never sends OUTP — capture pipeline only.
 */
import { useState } from 'react';
import { Download } from 'lucide-react';
import {
  IV_MODES, IV_MODE_LABELS, IV_MODE_TEMPLATE_PATH,
  readIvMode, useIvModeStore, type IvMode,
} from '@/lib/iv-mode-store';

interface IVModeSelectorProps {
  moduleId: string;
  onModuleIdChange: (id: string) => void;
}

export default function IVModeSelector({ moduleId, onModuleIdChange }: IVModeSelectorProps) {
  const modes = useIvModeStore((s) => s.modes);
  const setMode = useIvModeStore((s) => s.setMode);
  const mode = readIvMode(modes, moduleId);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  async function handleDownload(): Promise<void> {
    setStatus('loading');
    try {
      const slug = IV_MODE_TEMPLATE_PATH[mode];
      const res = await fetch(`/api/iv/${slug}/template`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const ext = mode === 'ivImport' ? 'xlsx' : 'json';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `iv-template-${slug}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div
      data-testid="iv-mode-selector"
      className="bg-gray-900 rounded-lg border border-gray-700 p-4 space-y-3"
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-bold text-orange-300">IV Source</h3>
        <span className="text-[10px] text-gray-500">Persists per Module ID</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1" htmlFor="iv-module-id">
            Module ID
          </label>
          <input
            id="iv-module-id"
            data-testid="iv-module-id"
            value={moduleId}
            onChange={(e) => onModuleIdChange(e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200"
          />
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1" htmlFor="iv-mode-select">
            IV Source
          </label>
          <select
            id="iv-mode-select"
            data-testid="iv-mode-select"
            value={mode}
            onChange={(e) => setMode(moduleId, e.target.value as IvMode)}
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200"
          >
            {IV_MODES.map((m) => (
              <option key={m} value={m}>
                {IV_MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end">
          <button
            type="button"
            data-testid="iv-template-download"
            onClick={handleDownload}
            disabled={status === 'loading'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white text-xs rounded font-semibold transition-colors w-full justify-center"
          >
            <Download className="w-3.5 h-3.5" />
            {status === 'loading' ? 'Downloading…' : 'Download template'}
          </button>
        </div>
      </div>

      {status === 'error' && (
        <p
          data-testid="iv-template-error"
          className="text-[11px] text-red-400 bg-red-900/20 border border-red-700/40 rounded px-2 py-1"
        >
          Template fetch failed — backend offline or unsupported mode.
        </p>
      )}

      <p className="text-[10px] text-gray-500">
        Selecting a mode configures only the capture pipeline. PSU output remains OFF.
      </p>
    </div>
  );
}
