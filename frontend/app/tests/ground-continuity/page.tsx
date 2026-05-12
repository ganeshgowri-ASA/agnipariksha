'use client';

import { useCallback, useEffect, useState } from 'react';

interface ProbePoint {
  id: string;
  label: string;
  x: number;
  y: number;
}

interface ProbeResult {
  probe_id: string;
  label: string;
  test_current_a: number;
  duration_s: number;
  n_samples: number;
  mean_voltage_v: number;
  mean_current_a: number;
  resistance_ohm: number;
  resistance_min_ohm: number;
  resistance_max_ohm: number;
  contact_stability_pct: number;
  pass_resistance_ohm: number;
  passed: boolean;
  csv_path: string | null;
}

interface RunResult {
  session_id: string;
  module_id: string;
  standard: string;
  test_current_a: number;
  pass_resistance_ohm: number;
  overall_pass: boolean;
  result: 'PASS' | 'FAIL';
  artifact_dir: string;
  probes: ProbeResult[];
  report_path?: string;
}

const BACKEND_BASE =
  process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000';

// Mirror of backend defaults so the page works offline.
const DEFAULT_PROBES: ProbePoint[] = [
  { id: 'p1', label: 'Frame TL', x: 0.05, y: 0.05 },
  { id: 'p2', label: 'Frame TR', x: 0.95, y: 0.05 },
  { id: 'p3', label: 'Frame BL', x: 0.05, y: 0.95 },
  { id: 'p4', label: 'Frame BR', x: 0.95, y: 0.95 },
  { id: 'p5', label: 'J-Box GND', x: 0.5, y: 0.55 },
];

export default function GroundContinuityPage() {
  const [moduleId, setModuleId] = useState('MOD-DEFAULT');
  const [ratedCurrent, setRatedCurrent] = useState(9.5);
  const [duration, setDuration] = useState(120);
  const [sampleRateHz, setSampleRateHz] = useState(5);
  const [passOhm, setPassOhm] = useState(0.1);
  const [probes, setProbes] = useState<ProbePoint[]>(DEFAULT_PROBES);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Computed test current per IEC 61730-2 MST 13 = max(2.5*Ir, 25)
  const testCurrent = Math.max(2.5 * ratedCurrent, 25);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BACKEND_BASE}/api/tests/ground-continuity/probe-map`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!cancelled && d?.probes) setProbes(d.probes as ProbePoint[]);
      })
      .catch(() => {
        /* keep defaults */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const runTest = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch(
        `${BACKEND_BASE}/api/tests/ground-continuity/run`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            module_id: moduleId,
            rated_module_current_a: ratedCurrent,
            duration_per_point_s: duration,
            sample_rate_hz: sampleRateHz,
            pass_resistance_ohm: passOhm,
            demo: true,
            render_report: true,
          }),
        },
      );
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      }
      const data = (await r.json()) as RunResult;
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }, [moduleId, ratedCurrent, duration, sampleRateHz, passOhm]);

  return (
    <div
      data-testid="gc-page"
      className="min-h-screen bg-gray-950 text-gray-100 p-6"
    >
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-green-400">
          Ground Continuity Test
        </h1>
        <p className="text-sm text-gray-400">
          IEC 61730-2 MST 13 — Continuity of equipotential bonding. Apply{' '}
          <span className="text-yellow-300 font-mono">
            max(2.5 × I<sub>rated</sub>, 25 A)
          </span>{' '}
          DC for ≥ 2 min between earth and each exposed conductive part;{' '}
          <span className="text-green-300 font-mono">R ≤ 0.1 Ω</span>.
        </p>
      </header>

      <section className="grid lg:grid-cols-3 gap-6">
        {/* ---- Setup ---- */}
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-bold text-green-400 mb-2">Configuration</h2>
          {[
            ['Module ID', moduleId, (v: string) => setModuleId(v), 'text'],
            [
              'Rated module current (A)',
              ratedCurrent,
              (v: string) => setRatedCurrent(Number(v)),
              'number',
            ],
            [
              'Duration / probe (s)',
              duration,
              (v: string) => setDuration(Number(v)),
              'number',
            ],
            [
              'Sample rate (Hz)',
              sampleRateHz,
              (v: string) => setSampleRateHz(Number(v)),
              'number',
            ],
            [
              'Pass limit R (Ω)',
              passOhm,
              (v: string) => setPassOhm(Number(v)),
              'number',
            ],
          ].map(([label, value, setter, type]) => (
            <label key={label as string} className="block">
              <span className="text-xs text-gray-400 block mb-1">
                {label as string}
              </span>
              <input
                type={type as string}
                value={value as string | number}
                onChange={e =>
                  (setter as (v: string) => void)(e.target.value)
                }
                data-testid={`gc-input-${(label as string)
                  .replace(/[^a-z0-9]+/gi, '-')
                  .toLowerCase()}`}
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200"
              />
            </label>
          ))}
          <div className="text-xs text-gray-300 bg-gray-800/60 rounded p-2 mt-2">
            Computed test current:{' '}
            <span
              data-testid="gc-test-current"
              className="text-yellow-300 font-mono"
            >
              {testCurrent.toFixed(2)} A
            </span>
          </div>
          <button
            data-testid="gc-run"
            disabled={running}
            onClick={runTest}
            className="w-full bg-green-600 disabled:bg-gray-600 hover:bg-green-500 text-white font-bold py-2 rounded mt-2"
          >
            {running ? 'Running…' : 'Run Ground Continuity Sweep'}
          </button>
          {error && (
            <p className="text-xs text-red-400 mt-2" data-testid="gc-error">
              {error}
            </p>
          )}
        </div>

        {/* ---- Probe Map ---- */}
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
          <h2 className="text-sm font-bold text-green-400 mb-2">
            Probe Map (placeholder)
          </h2>
          <div
            data-testid="gc-probe-map"
            className="relative w-full"
            style={{ aspectRatio: '4 / 3' }}
          >
            <div className="absolute inset-0 border-2 border-gray-600 rounded bg-gray-800/40" />
            <div className="absolute inset-x-1/3 inset-y-1/4 border border-dashed border-gray-700" />
            {probes.map(p => {
              const r = result?.probes.find(rp => rp.probe_id === p.id);
              const color = r
                ? r.passed
                  ? 'bg-green-500'
                  : 'bg-red-500'
                : 'bg-yellow-400';
              return (
                <div
                  key={p.id}
                  data-testid={`gc-probe-${p.id}`}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full ${color}`}
                  style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                  title={`${p.id}: ${p.label}`}
                />
              );
            })}
          </div>
          <ul className="mt-3 text-xs text-gray-400 space-y-1">
            {probes.map(p => (
              <li key={p.id}>
                <span className="font-mono text-gray-300">{p.id}</span>{' '}
                — {p.label}
              </li>
            ))}
          </ul>
        </div>

        {/* ---- Results table ---- */}
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 lg:col-span-1">
          <h2 className="text-sm font-bold text-green-400 mb-2">Per-probe results</h2>
          {!result && (
            <p className="text-xs text-gray-500" data-testid="gc-empty">
              Run a sweep to populate the resistance table.
            </p>
          )}
          {result && (
            <div className="overflow-x-auto" data-testid="gc-results">
              <p
                className={`text-sm font-bold mb-2 ${
                  result.overall_pass ? 'text-green-400' : 'text-red-400'
                }`}
                data-testid="gc-verdict"
              >
                Overall: {result.result}
              </p>
              <table className="w-full text-xs text-left">
                <thead className="text-gray-400 border-b border-gray-700">
                  <tr>
                    <th className="py-1 pr-2">ID</th>
                    <th className="py-1 pr-2">Label</th>
                    <th className="py-1 pr-2 text-right">R (Ω)</th>
                    <th className="py-1 pr-2 text-right">Stab %</th>
                    <th className="py-1 pr-2 text-right">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {result.probes.map(p => (
                    <tr
                      key={p.probe_id}
                      data-testid={`gc-row-${p.probe_id}`}
                      className={
                        p.passed
                          ? 'bg-green-900/20 border-b border-green-800/40'
                          : 'bg-red-900/20 border-b border-red-800/40'
                      }
                    >
                      <td className="py-1 pr-2 font-mono">{p.probe_id}</td>
                      <td className="py-1 pr-2">{p.label}</td>
                      <td className="py-1 pr-2 text-right font-mono">
                        {p.resistance_ohm.toFixed(6)}
                      </td>
                      <td className="py-1 pr-2 text-right">
                        {p.contact_stability_pct.toFixed(1)}
                      </td>
                      <td
                        className={`py-1 pr-2 text-right font-bold ${
                          p.passed ? 'text-green-300' : 'text-red-300'
                        }`}
                      >
                        {p.passed ? 'PASS' : 'FAIL'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p
                className="mt-3 text-[10px] text-gray-500 break-all"
                data-testid="gc-artifact-dir"
              >
                Raw CSV traces: {result.artifact_dir}
              </p>
              {result.report_path && (
                <p
                  className="text-[10px] text-gray-500 break-all"
                  data-testid="gc-report-path"
                >
                  Report: {result.report_path}
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      <footer className="mt-6 text-[11px] text-gray-500 border-t border-gray-800 pt-3">
        Reference:{' '}
        <span className="font-mono">
          IEC 61730-2 MST 13 — Continuity of equipotential bonding.
        </span>
      </footer>
    </div>
  );
}
