'use client';

/**
 * Compact operator/customer context editor for the dashboard header.
 *
 * Captures Operator / Operator ID / Company / Customer / Equipment ID /
 * Method Reference so every test session can stamp them onto its
 * `TestSession` record via `stampOperatorContext()`. The values persist
 * in localStorage and survive page reloads.
 *
 * UX: collapsed to a single chip showing the active operator. Click to
 * expand into a 6-field form. The chip shows "Anonymous" until the
 * operator types their name.
 */
import { useState } from 'react';
import { User, ChevronDown, ChevronUp } from 'lucide-react';
import { useOperatorContext, setOperatorContext } from '@/lib/operator-store';

const FIELDS: Array<{ key: keyof ReturnType<typeof useOperatorContext>; label: string; placeholder: string }> = [
  { key: 'operatorName',    label: 'Operator',         placeholder: 'e.g. Mounika Mandru' },
  { key: 'operatorId',      label: 'Operator ID',      placeholder: 'e.g. EMP-1234' },
  { key: 'companyName',     label: 'Company / Lab',    placeholder: 'e.g. ASA Test Labs' },
  { key: 'customerName',    label: 'Customer',         placeholder: 'e.g. Reliance Industries Limited' },
  { key: 'equipmentId',     label: 'Equipment ID',     placeholder: 'PV6000 + SH-242 + 34465A' },
  { key: 'methodReference', label: 'Method reference', placeholder: 'e.g. SOW-2026-PV-RIL-01' },
];

export default function OperatorPicker() {
  const ctx = useOperatorContext();
  const [open, setOpen] = useState(false);
  const label = ctx.operatorName || 'Anonymous';
  const sub = ctx.customerName ? `· ${ctx.customerName}` : '';

  return (
    <div className="relative" data-testid="operator-picker">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-gray-700 bg-gray-900/80 hover:bg-gray-800 text-xs text-gray-200"
        aria-expanded={open}
      >
        <User className="w-3.5 h-3.5 opacity-70" />
        <span className="font-medium">{label}</span>
        {sub && <span className="text-gray-400">{sub}</span>}
        {open ? <ChevronUp className="w-3.5 h-3.5 opacity-70" /> : <ChevronDown className="w-3.5 h-3.5 opacity-70" />}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[420px] bg-gray-950 border border-gray-700 rounded-lg shadow-xl p-4 z-30">
          <h3 className="text-xs font-semibold text-gray-200 mb-3">Session context · stamped on every new test</h3>
          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1 text-[11px] text-gray-400">
                {f.label}
                <input
                  type="text"
                  value={ctx[f.key] ?? ''}
                  placeholder={f.placeholder}
                  onChange={(e) => setOperatorContext({ [f.key]: e.target.value })}
                  className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-blue-500"
                  data-testid={`operator-picker-${f.key}`}
                />
              </label>
            ))}
          </div>
          <p className="mt-3 text-[10px] text-gray-500">
            Stored locally in this browser. Operator / Customer / Equipment values stamp onto each new
            test session as it starts — they appear in the IEC report header instead of &quot;NA&quot;.
          </p>
        </div>
      )}
    </div>
  );
}
