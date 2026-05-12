'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, Plus, Cpu } from 'lucide-react';
import { ModulesAPI } from '@/lib/api';
import { DEFAULT_MODULE, type ModuleInput, type PVModule } from '@/types/module';
import { useModuleStore } from '@/hooks/useModuleStore';

interface Props {
  className?: string;
}

const TECH_OPTIONS = ['mono-PERC', 'TOPCon', 'HJT', 'PERC bifacial glass-glass', 'thin-film CIGS', 'thin-film CdTe'];

export default function ModuleSelector({ className }: Props) {
  const modules = useModuleStore((s) => s.modules);
  const setModules = useModuleStore((s) => s.setModules);
  const upsertModule = useModuleStore((s) => s.upsertModule);
  const selectedId = useModuleStore((s) => s.selectedId);
  const select = useModuleStore((s) => s.select);
  const markReady = useModuleStore((s) => s.markReady);

  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ModulesAPI.list()
      .then((list) => {
        if (cancelled) return;
        setModules(list);
        markReady();
      })
      .catch(() => {
        markReady();
      });
    return () => {
      cancelled = true;
    };
  }, [setModules, markReady]);

  const selected = modules.find((m) => m.module_id === selectedId) ?? null;

  return (
    <div className={`relative ${className ?? ''}`} data-testid="module-selector">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 font-medium transition-colors"
      >
        <Cpu className="w-3.5 h-3.5 text-orange-300" />
        <span className="font-mono text-[11px] text-gray-400">Module</span>
        <span className="max-w-[200px] truncate text-white">
          {selected ? `${selected.manufacturer} ${selected.model}` : 'Select…'}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-50 min-w-[320px] bg-gray-950 border border-gray-700 rounded-md shadow-xl py-1"
          onMouseLeave={() => setOpen(false)}
        >
          {modules.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-500">No modules yet — add one to begin.</div>
          )}
          {modules.map((m) => (
            <button
              key={m.module_id}
              type="button"
              onClick={() => {
                select(m.module_id);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 hover:bg-gray-800 text-xs ${
                m.module_id === selectedId ? 'bg-gray-800 text-white' : 'text-gray-300'
              }`}
            >
              <div className="font-medium">{m.manufacturer} <span className="text-gray-400">{m.model}</span></div>
              <div className="text-[10px] text-gray-500 font-mono">
                {m.technology} · {m.pmax_stc} W · Voc {m.voc} V · Isc {m.isc} A
                {m.bypass_diode_part ? ` · diode ${m.bypass_diode_part}` : ''}
              </div>
            </button>
          ))}
          <div className="border-t border-gray-800 mt-1 pt-1">
            <button
              type="button"
              onClick={() => {
                setModalOpen(true);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-xs text-orange-300 hover:bg-gray-800 inline-flex items-center gap-2"
              data-testid="module-new"
            >
              <Plus className="w-3.5 h-3.5" /> New module…
            </button>
          </div>
        </div>
      )}

      {modalOpen && (
        <NewModuleModal
          onClose={() => setModalOpen(false)}
          onCreated={(m) => {
            upsertModule(m);
            setModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

interface ModalProps {
  onClose: () => void;
  onCreated: (m: PVModule) => void;
}

function NewModuleModal({ onClose, onCreated }: ModalProps) {
  const [form, setForm] = useState<ModuleInput>({ ...DEFAULT_MODULE });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setField = <K extends keyof ModuleInput>(k: K, v: ModuleInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const onSubmit = async () => {
    if (!form.manufacturer || !form.model) {
      setError('Manufacturer and model are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const m = await ModulesAPI.create(form);
      onCreated(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      data-testid="module-modal"
    >
      <div
        className="bg-gray-950 border border-gray-700 rounded-lg shadow-2xl w-full max-w-2xl p-5 max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-white mb-3">Register PV module</h2>
        <p className="text-xs text-gray-400 mb-4">
          Captures the datasheet so the AI assistant can ground analysis (Pmax,
          Tj limits, diode part) without re-asking the operator.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Manufacturer" value={form.manufacturer} onChange={(v) => setField('manufacturer', v)} required />
          <Field label="Model" value={form.model} onChange={(v) => setField('model', v)} required />

          <Select label="Technology" value={form.technology} onChange={(v) => setField('technology', v)} options={TECH_OPTIONS} />
          <Num label="Pmax @ STC (W)" value={form.pmax_stc} onChange={(v) => setField('pmax_stc', v)} />

          <Num label="Voc (V)" value={form.voc} onChange={(v) => setField('voc', v)} />
          <Num label="Isc (A)" value={form.isc} onChange={(v) => setField('isc', v)} />
          <Num label="Vmpp (V)" value={form.vmpp} onChange={(v) => setField('vmpp', v)} />
          <Num label="Impp (A)" value={form.impp} onChange={(v) => setField('impp', v)} />

          <Num label="Bifaciality (0..1)" value={form.bifaciality} onChange={(v) => setField('bifaciality', v)} step={0.01} />
          <Num label="Area (m²)" value={form.area_m2} onChange={(v) => setField('area_m2', v)} step={0.01} />

          <Field label="Junction box" value={form.junction_box} onChange={(v) => setField('junction_box', v)} />
          <Field label="Bypass diode part" value={form.bypass_diode_part} onChange={(v) => setField('bypass_diode_part', v)} />

          <Field label="Datasheet URL" value={form.datasheet_url} onChange={(v) => setField('datasheet_url', v)} wide />
          <Field label="Notes" value={form.notes} onChange={(v) => setField('notes', v)} wide />
        </div>

        {error && (
          <div className="mt-3 text-xs text-red-300 bg-red-900/30 border border-red-700/50 rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 rounded"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onSubmit}
            data-testid="module-save"
            className="px-3 py-1.5 text-xs bg-orange-600 hover:bg-orange-500 disabled:bg-gray-700 text-white rounded font-medium"
          >
            {busy ? 'Saving…' : 'Create module'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, required, wide,
}: {
  label: string; value: string; onChange: (v: string) => void; required?: boolean; wide?: boolean;
}) {
  return (
    <label className={`flex flex-col text-xs text-gray-400 ${wide ? 'md:col-span-2' : ''}`}>
      <span className="mb-1">{label}{required && <span className="text-red-400"> *</span>}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-gray-200 focus:outline-none focus:border-orange-500"
      />
    </label>
  );
}

function Num({
  label, value, onChange, step = 0.1,
}: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="flex flex-col text-xs text-gray-400">
      <span className="mb-1">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-gray-200 focus:outline-none focus:border-orange-500"
      />
    </label>
  );
}

function Select({
  label, value, onChange, options,
}: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="flex flex-col text-xs text-gray-400">
      <span className="mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-gray-200"
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
