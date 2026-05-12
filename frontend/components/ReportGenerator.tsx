'use client';

import { useMemo, useState } from 'react';
import { GATE2_PMAX_DELTA_PERCENT, type TestSession } from '@/types/test-session';

interface ReportGeneratorProps {
  session: TestSession | null;
  testName: string;
  standard: string;
}

const BRAND_LAB = 'Shreshtata Power Supplies — ASA PV Testing Laboratory';

const SECTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'header',           label: 'Header' },
  { id: 'test_description', label: 'Test Description' },
  { id: 'iec_clause',       label: 'IEC Clause' },
  { id: 'parameters',       label: 'Parameters' },
  { id: 'graphs',           label: 'Graphs' },
  { id: 'tables',           label: 'Tables' },
  { id: 'pass_fail',        label: 'Pass / Fail' },
  { id: 'raw_data_path',    label: 'Raw Data Path' },
  { id: 'error_log',        label: 'Error Log' },
  { id: 'troubleshooting',  label: 'Troubleshooting' },
  { id: 'signature',        label: 'Signature' },
  { id: 'photos',           label: 'Photos' },
];

const GRAPHS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'voltage',      label: 'Voltage' },
  { id: 'current',      label: 'Current' },
  { id: 'power',        label: 'Power' },
  { id: 'temperature',  label: 'Temperature' },
  { id: 'rh',           label: 'RH' },
  { id: 'tj',           label: 'Tj' },
  { id: 'vf_vs_t',      label: 'Vf vs T' },
];

const TABLES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'raw',       label: 'Raw' },
  { id: 'decimated', label: 'Decimated' },
  { id: 'summary',   label: 'Summary' },
];

const DEFAULT_API = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');

export default function ReportGenerator({ session, testName, standard }: ReportGeneratorProps) {
  const [loading, setLoading] = useState<'pdf' | 'docx' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operatorName, setOperatorName] = useState('');
  const [labName, setLabName] = useState(BRAND_LAB);
  const [moduleId, setModuleId] = useState('');
  const [notes, setNotes] = useState('');
  const [rawPath, setRawPath] = useState('');

  const [sections, setSections] = useState<Set<string>>(() => new Set(SECTIONS.map(s => s.id)));
  const [graphs, setGraphs]     = useState<Set<string>>(() => new Set(GRAPHS.map(g => g.id)));
  const [tables, setTables]     = useState<Set<string>>(() => new Set(TABLES.map(t => t.id)));

  const stats = useMemo(() => {
    if (!session || session.readings.length === 0) return null;
    const rs = session.readings;
    const ps = rs.map(r => r.power);
    const pre = session.preMaxPower ?? ps[0];
    const post = session.postMaxPower ?? ps[ps.length - 1];
    const delta = pre > 0 ? ((post - pre) / pre) * 100 : 0;
    return {
      count: rs.length,
      avgV: rs.reduce((a, r) => a + r.voltage, 0) / rs.length,
      avgI: rs.reduce((a, r) => a + r.current, 0) / rs.length,
      avgP: ps.reduce((a, b) => a + b, 0) / ps.length,
      pre, post, delta,
      gatePass: delta >= GATE2_PMAX_DELTA_PERCENT,
      duration: session.endTime
        ? ((session.endTime - session.startTime) / 60_000).toFixed(1)
        : ((Date.now() - session.startTime) / 60_000).toFixed(1),
    };
  }, [session]);

  const verdict = !stats
    ? 'IN PROGRESS'
    : session?.result ?? (stats.gatePass ? 'PASS' : 'FAIL');

  function toggle(setFn: (s: Set<string>) => void, current: Set<string>, id: string) {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    setFn(next);
  }

  async function generate(format: 'pdf' | 'docx') {
    if (!session) return;
    setLoading(format);
    setError(null);
    try {
      const body = {
        run_id: session.id,
        testName,
        standard,
        iec_clause: session.iecClause ?? standard,
        operator: operatorName,
        moduleId,
        lab_name: labName,
        notes,
        raw_data_path: rawPath || session.rawDataPath || '',
        result: verdict,
        pre_max_power: stats?.pre ?? null,
        post_max_power: stats?.post ?? null,
        delta_pmax_percent: stats?.delta ?? null,
        threshold_percent: GATE2_PMAX_DELTA_PERCENT,
        sections: Array.from(sections),
        graphs: Array.from(graphs),
        tables: Array.from(tables),
        format,
        readings: session.readings.map(r => ({
          timestamp: r.timestamp - session.startTime,
          voltage: r.voltage,
          current: r.current,
          power: r.power,
          temperature: r.temperature ?? null,
        })),
        qr_base_url: typeof window !== 'undefined' ? window.location.origin : '',
      };

      const r = await fetch(`${DEFAULT_API}/api/reports/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${testName.replace(/\s+/g, '_')}_${session.id}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4 space-y-3">
        <h3 className="text-sm font-bold text-gray-200">Report Configuration</h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Module ID',    value: moduleId,     set: setModuleId,     ph: 'e.g. MOD-2026-001' },
            { label: 'Operator',     value: operatorName, set: setOperatorName, ph: 'Your name' },
            { label: 'Laboratory',   value: labName,      set: setLabName,      ph: 'Lab name' },
            { label: 'Raw data path', value: rawPath,     set: setRawPath,      ph: '/data/runs/...' },
          ].map(f => (
            <div key={f.label}>
              <label className="text-xs text-gray-400 block mb-1">{f.label}</label>
              <input
                value={f.value} onChange={e => f.set(e.target.value)} placeholder={f.ph}
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200"
              />
            </div>
          ))}
          <div className="col-span-2">
            <label className="text-xs text-gray-400 block mb-1">Notes</label>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Observations, deviations..."
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200 resize-none"
            />
          </div>
        </div>
      </div>

      <CheckboxGroup
        title="Sections"
        items={SECTIONS}
        selected={sections}
        onToggle={(id) => toggle(setSections, sections, id)}
        testId="rg-sections"
      />
      <CheckboxGroup
        title="Graphs"
        items={GRAPHS}
        selected={graphs}
        onToggle={(id) => toggle(setGraphs, graphs, id)}
        disabled={!sections.has('graphs')}
        testId="rg-graphs"
      />
      <CheckboxGroup
        title="Tables"
        items={TABLES}
        selected={tables}
        onToggle={(id) => toggle(setTables, tables, id)}
        disabled={!sections.has('tables')}
        testId="rg-tables"
      />

      {stats && (
        <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
          <h3 className="text-sm font-bold text-gray-200 mb-3">Test Summary</h3>
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat label="Avg Voltage" value={stats.avgV.toFixed(3)} unit="V" color="text-blue-400" />
            <Stat label="Avg Current" value={stats.avgI.toFixed(3)} unit="A" color="text-green-400" />
            <Stat label="Duration"    value={stats.duration}        unit="min" color="text-yellow-400" />
            <Stat label="ΔPmax"       value={stats.delta.toFixed(2)} unit="%"
                  color={stats.gatePass ? 'text-green-400' : 'text-red-400'} />
            <Stat label="Pre Pmax"    value={stats.pre.toFixed(3)}  unit="W" color="text-gray-200" />
            <Stat label="Post Pmax"   value={stats.post.toFixed(3)} unit="W" color="text-gray-200" />
          </div>
          <div className={`mt-3 py-2 text-center rounded font-bold text-sm ${
            verdict === 'PASS' ? 'bg-green-900/50 text-green-400'
              : verdict === 'FAIL' ? 'bg-red-900/50 text-red-400'
                : 'bg-gray-800 text-gray-400'
          }`}>
            {verdict}
          </div>
        </div>
      )}

      {error && (
        <div className="text-xs text-red-400 bg-red-900/30 border border-red-700/50 rounded px-3 py-2">
          Export failed: {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button" onClick={() => generate('pdf')}
          disabled={loading !== null || !session}
          data-testid="rg-export-pdf"
          className="flex-1 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm rounded font-medium transition-colors"
        >
          {loading === 'pdf' ? 'Generating…' : 'Export PDF'}
        </button>
        <button
          type="button" onClick={() => generate('docx')}
          disabled={loading !== null || !session}
          data-testid="rg-export-docx"
          className="flex-1 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-sm rounded font-medium transition-colors"
        >
          {loading === 'docx' ? 'Generating…' : 'Export Word'}
        </button>
      </div>
    </div>
  );
}

function CheckboxGroup({
  title, items, selected, onToggle, disabled, testId,
}: {
  title: string;
  items: ReadonlyArray<{ id: string; label: string }>;
  selected: Set<string>;
  onToggle: (id: string) => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <div
      className={`bg-gray-900 rounded-lg border border-gray-700 p-3 ${disabled ? 'opacity-50' : ''}`}
      data-testid={testId}
    >
      <h4 className="text-xs font-bold text-gray-300 mb-2">{title}</h4>
      <div className="grid grid-cols-3 gap-1.5">
        {items.map(it => (
          <label key={it.id} className="flex items-center gap-2 text-xs text-gray-300">
            <input
              type="checkbox"
              checked={selected.has(it.id)}
              onChange={() => onToggle(it.id)}
              disabled={disabled}
              data-testid={`${testId}-${it.id}`}
              className="accent-orange-500"
            />
            {it.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label, value, unit, color = 'text-white',
}: { label: string; value: string; unit: string; color?: string }) {
  return (
    <div className="bg-gray-800 rounded p-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-mono font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500">{unit}</p>
    </div>
  );
}
