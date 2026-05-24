'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  type Mqt18Recipe,
  deriveCurrents,
  makeDefaultMqt18Recipe,
  makeDiode,
  validateMqt18Recipe,
} from './mqt18';

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'error'; messages: string[] }
  | { kind: 'not_implemented'; detail: string };

const RECIPE_ENDPOINT = '/api/bdt/mqt18-1/recipes';

export default function Mqt18SetupForm() {
  const [recipe, setRecipe] = useState<Mqt18Recipe>(makeDefaultMqt18Recipe);
  const [submit, setSubmit] = useState<SubmitState>({ kind: 'idle' });

  // currents_a is always derived from Isc; keep it in sync for display + submit.
  const currents = useMemo(() => deriveCurrents(recipe.nameplate.isc_a), [recipe.nameplate.isc_a]);

  const patchNameplate = (patch: Partial<Mqt18Recipe['nameplate']>) =>
    setRecipe(r => ({ ...r, nameplate: { ...r.nameplate, ...patch } }));
  const patchProtocol = (patch: Partial<Mqt18Recipe['protocol']>) =>
    setRecipe(r => ({ ...r, protocol: { ...r.protocol, ...patch } }));
  const patchEquipment = (patch: Partial<Mqt18Recipe['equipment']>) =>
    setRecipe(r => ({ ...r, equipment: { ...r.equipment, ...patch } }));
  const patchDiode = (idx: number, patch: Partial<Mqt18Recipe['diodes'][number]>) =>
    setRecipe(r => ({ ...r, diodes: r.diodes.map((d, i) => (i === idx ? { ...d, ...patch } : d)) }));
  const addDiode = () => setRecipe(r => ({ ...r, diodes: [...r.diodes, makeDiode()] }));
  const removeDiode = (idx: number) =>
    setRecipe(r => ({ ...r, diodes: r.diodes.filter((_, i) => i !== idx) }));

  async function onSubmit() {
    const payload: Mqt18Recipe = { ...recipe, protocol: { ...recipe.protocol, currents_a: currents } };
    const errors = validateMqt18Recipe(payload);
    if (errors.length > 0) {
      setSubmit({ kind: 'error', messages: errors });
      return;
    }
    setSubmit({ kind: 'submitting' });
    try {
      const res = await fetch(RECIPE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 501) {
        const body = await res.json().catch(() => ({}));
        setSubmit({
          kind: 'not_implemented',
          detail: body?.detail ?? 'Recipe persistence is not implemented yet.',
        });
        return;
      }
      if (!res.ok) {
        setSubmit({ kind: 'error', messages: [`Submit failed (HTTP ${res.status}).`] });
        return;
      }
      setSubmit({ kind: 'idle' });
    } catch (e) {
      setSubmit({ kind: 'error', messages: [e instanceof Error ? e.message : String(e)] });
    }
  }

  return (
    <div className="space-y-4" data-testid="mqt18-setup-form">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-bold text-yellow-400 mb-1">
          IEC 61215-2 MQT 18.1 — Bypass Diode Pulse Test
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          Forward-bias each diode with short pulses (≤1 ms) across a junction-temperature
          sweep; record V<sub>D</sub> vs T<sub>j</sub>.
        </p>

        {/* Nameplate */}
        <Section title="Module Nameplate">
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Manufacturer" value={recipe.nameplate.manufacturer}
              onChange={v => patchNameplate({ manufacturer: v })} />
            <TextField label="Model" value={recipe.nameplate.model}
              onChange={v => patchNameplate({ model: v })} />
            <TextField label="MSN" value={recipe.nameplate.msn}
              onChange={v => patchNameplate({ msn: v })} />
            <TextField label="MCIND" value={recipe.nameplate.mcind}
              onChange={v => patchNameplate({ mcind: v })} />
            <NumField label="Isc (A)" value={recipe.nameplate.isc_a} min={0} step={0.1}
              onChange={v => patchNameplate({ isc_a: v })} />
            <NumField label="Voc (V)" value={recipe.nameplate.voc_v} min={0} step={0.1}
              onChange={v => patchNameplate({ voc_v: v })} />
            <NumField label="System Voltage (V)" value={recipe.nameplate.system_voltage_v} min={0} step={1}
              onChange={v => patchNameplate({ system_voltage_v: v })} />
          </div>
        </Section>

        {/* Diodes */}
        <Section title="Bypass Diodes">
          <div className="space-y-2">
            {recipe.diodes.map((d, i) => (
              <div key={d.id} className="grid grid-cols-[1fr_1.4fr_1fr_1fr_auto] gap-2 items-end"
                data-testid={`mqt18-diode-${i}`}>
                <TextField label="ID" value={d.id} onChange={v => patchDiode(i, { id: v })} />
                <TextField label="Part No." value={d.part_number}
                  onChange={v => patchDiode(i, { part_number: v })} />
                <NumField label="Tjmax (°C)" value={d.tjmax_c} min={0} step={1}
                  onChange={v => patchDiode(i, { tjmax_c: v })} />
                <NumField label="Fuse (A)" value={d.fuse_current_a} min={0} step={0.5}
                  onChange={v => patchDiode(i, { fuse_current_a: v })} />
                <button type="button" onClick={() => removeDiode(i)}
                  disabled={recipe.diodes.length <= 1}
                  className="mb-0.5 p-1.5 rounded bg-gray-800 border border-gray-600 text-red-400 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label={`Remove diode ${i + 1}`} data-testid={`mqt18-remove-diode-${i}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button type="button" onClick={addDiode} data-testid="mqt18-add-diode"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded bg-gray-800 border border-gray-600 text-gray-200 hover:bg-gray-700">
              <Plus className="w-3.5 h-3.5" /> Add diode
            </button>
          </div>
        </Section>

        {/* Protocol */}
        <Section title="Protocol">
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Pulse Width (ms, ≤1.0)" value={recipe.protocol.pulse_width_ms}
              min={0} max={1.0} step={0.1} onChange={v => patchProtocol({ pulse_width_ms: v })} />
            <NumField label="Repeats / Step" value={recipe.protocol.repeats_per_step}
              min={1} step={1} onChange={v => patchProtocol({ repeats_per_step: Math.trunc(v) })} />
            <TextField label="Temperature Steps (°C)"
              value={recipe.protocol.temperature_steps_c.join(', ')}
              onChange={v => patchProtocol({ temperature_steps_c: parseNumList(v) })} />
            <div>
              <label className="text-xs text-gray-400 block mb-1">Currents (A, auto from Isc)</label>
              <div className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300"
                data-testid="mqt18-derived-currents">
                {currents.length > 0 ? currents.join(', ') : '— set Isc —'}
              </div>
            </div>
          </div>
        </Section>

        {/* Equipment + operator */}
        <Section title="Equipment & Operator">
          <div className="grid grid-cols-2 gap-3">
            <TextField label="PSU ID" value={recipe.equipment.psu_id}
              onChange={v => patchEquipment({ psu_id: v })} />
            <TextField label="Scope ID (optional)" value={recipe.equipment.scope_id}
              onChange={v => patchEquipment({ scope_id: v })} />
            <TextField label="TC Logger ID" value={recipe.equipment.tc_logger_id}
              onChange={v => patchEquipment({ tc_logger_id: v })} />
            <TextField label="Operator" value={recipe.operator}
              onChange={v => setRecipe(r => ({ ...r, operator: v }))} />
          </div>
        </Section>

        <div className="mt-4 flex items-center gap-3">
          <button type="button" onClick={onSubmit} disabled={submit.kind === 'submitting'}
            data-testid="mqt18-submit"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded font-semibold bg-yellow-700 hover:bg-yellow-600 text-white disabled:opacity-40">
            {submit.kind === 'submitting' ? 'Submitting…' : 'Save MQT 18.1 Recipe'}
          </button>
        </div>

        {submit.kind === 'error' && (
          <div className="mt-3 bg-red-900/20 border border-red-700/40 rounded p-3"
            data-testid="mqt18-errors">
            <p className="text-xs font-semibold text-red-300 mb-1">Please fix the following:</p>
            <ul className="list-disc list-inside text-xs text-red-300 space-y-0.5">
              {submit.messages.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          </div>
        )}
        {submit.kind === 'not_implemented' && (
          <div className="mt-3 bg-blue-900/20 border border-blue-700/40 rounded p-3"
            data-testid="mqt18-not-implemented">
            <p className="text-xs text-blue-300">{submit.detail}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h4 className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">{title}</h4>
      {children}
    </div>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs text-gray-400 block mb-1">{label}</label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200" />
    </div>
  );
}

function NumField({ label, value, onChange, min, max, step }: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number;
}) {
  return (
    <div>
      <label className="text-xs text-gray-400 block mb-1">{label}</label>
      <input type="number" value={value} min={min} max={max} step={step}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200" />
    </div>
  );
}

function parseNumList(s: string): number[] {
  return s
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0)
    .map(Number);
}
