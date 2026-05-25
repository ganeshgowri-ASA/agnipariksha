'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Lock, Pencil } from 'lucide-react';
import {
  type Nameplate,
  NAMEPLATE_DEFAULTS,
  saveNameplate,
  setCurrentModuleId,
  useNameplate,
  useNameplateState,
} from '@/lib/nameplate-store';

type Field =
  | { key: keyof Nameplate; label: string; type: 'text'; placeholder?: string }
  | { key: keyof Nameplate; label: string; type: 'number'; unit: string; step?: number };

const FIELDS: Field[] = [
  { key: 'manufacturer',    label: 'Manufacturer',       type: 'text', placeholder: 'e.g. Acme Solar' },
  { key: 'model',           label: 'Model',              type: 'text', placeholder: 'e.g. AS-450M' },
  { key: 'msn',             label: 'Module Serial (MSN)', type: 'text', placeholder: 'e.g. MSN-2026-001' },
  { key: 'mcind',           label: 'MCIND',              type: 'text' },
  { key: 'isc',             label: 'Isc',                type: 'number', unit: 'A', step: 0.1 },
  { key: 'voc',             label: 'Voc',                type: 'number', unit: 'V', step: 0.1 },
  { key: 'systemVoltage',   label: 'System voltage',     type: 'number', unit: 'V', step: 1 },
  { key: 'bypassDiodes',    label: 'Bypass diodes',      type: 'number', unit: '', step: 1 },
  { key: 'diodePartNumber', label: 'Diode part no.',     type: 'text' },
  { key: 'diodeTjMax',      label: 'Diode Tj max',       type: 'number', unit: '°C', step: 1 },
  { key: 'fuseCurrent',     label: 'Fuse current',       type: 'number', unit: 'A', step: 1 },
];

export default function NameplatePanel() {
  const { currentModuleId } = useNameplateState();
  const saved = useNameplate(currentModuleId);
  const [expanded, setExpanded] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [draft, setDraft] = useState<Nameplate>(saved ?? NAMEPLATE_DEFAULTS);

  // Re-seed the editable draft whenever the selected module changes.
  useEffect(() => {
    setDraft(saved ?? NAMEPLATE_DEFAULTS);
    setUnlocked(false);
  }, [currentModuleId]); // eslint-disable-line react-hooks/exhaustive-deps

  const locked = (saved?.used ?? false) && !unlocked;

  const update = (key: keyof Nameplate, value: string, isNumber: boolean) => {
    setDraft((d) => ({ ...d, [key]: isNumber ? Number(value) : value }));
  };

  const handleSave = () => {
    saveNameplate(currentModuleId, { ...draft, used: saved?.used ?? false });
    setUnlocked(false);
  };

  const handleEdit = () => {
    if (window.confirm('This module has already been used in a test session. Edit the nameplate anyway?')) {
      setUnlocked(true);
    }
  };

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 mb-4" data-testid="nameplate-panel">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left"
        data-testid="nameplate-toggle"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-2 text-sm font-bold text-orange-400">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Module nameplate
          {saved?.used && <Lock className="w-3.5 h-3.5 text-gray-500" />}
        </span>
        <span className="text-xs text-gray-500 truncate max-w-[50%]">
          {expanded ? 'Edit nameplate' : saved ? `${saved.manufacturer || '—'} · ${saved.model || '—'}` : 'Not set'}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-800 pt-3 space-y-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Module ID</label>
            <input
              type="text"
              value={currentModuleId}
              onChange={(e) => setCurrentModuleId(e.target.value)}
              placeholder="e.g. MOD-2026-001"
              data-testid="nameplate-module-id"
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <label className="text-xs text-gray-400 block mb-1">
                  {f.label}{f.type === 'number' && f.unit ? ` (${f.unit})` : ''}
                </label>
                <input
                  type={f.type}
                  value={String(draft[f.key])}
                  step={f.type === 'number' ? f.step : undefined}
                  placeholder={f.type === 'text' ? f.placeholder : undefined}
                  disabled={locked}
                  data-testid={`nameplate-${f.key}`}
                  onChange={(e) => update(f.key, e.target.value, f.type === 'number')}
                  className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-1">
            {locked ? (
              <button
                type="button"
                onClick={handleEdit}
                data-testid="nameplate-edit"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-gray-700 hover:bg-gray-600 text-gray-100"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSave}
                data-testid="nameplate-save"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-orange-700 hover:bg-orange-600 text-white"
              >
                Save nameplate
              </button>
            )}
            {saved?.used && (
              <span className="text-[11px] text-gray-500">
                Read-only — module already used in a test session.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
