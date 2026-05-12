'use client';

import { useCallback, useMemo, useState } from 'react';

type RcoSample = {
  t_s: number;
  current_a: number;
  voltage_v: number;
  t_surface_c: number;
  t_jbox_c: number;
  t_ambient_c: number;
};

type RcoResult = {
  session_id: string;
  passed: boolean;
  abort_reason: string;
  duration_s: number;
  sample_count: number;
  analysis: {
    standard: string;
    clauses: string[];
    test_current_a: number;
    peak_surface_temperature_c: number;
    peak_jbox_temperature_c: number;
    ambient_min_c: number;
    ambient_max_c: number;
    ambient_in_band: boolean;
    hotspot_event_count: number;
    failure_reasons: string[];
    verdict: 'PASS' | 'FAIL';
    time_temperature_profile: RcoSample[];
    post_test_stubs: Record<
      string,
      { status: string; description: string }
    >;
  };
  csv_path: string | null;
  summary_path: string | null;
  hotspot_map_path: string | null;
};

const BACKEND =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, '') || 'http://localhost:8000';

export default function ReverseCurrentOverloadPage() {
  const [iscStc, setIscStc] = useState(10.0);
  const [durationS, setDurationS] = useState(7200);
  const [ambientTargetC, setAmbientTargetC] = useState(30);
  const [ambientToleranceC, setAmbientToleranceC] = useState(5);
  const [abortTempC, setAbortTempC] = useState(200);
  const [voltageClampV, setVoltageClampV] = useState(30);
  const [hotspotEnabled, setHotspotEnabled] = useState(false);
  const [forceArc, setForceArc] = useState<number | ''>('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RcoResult | null>(null);

  const testCurrent = useMemo(() => +(iscStc * 1.35).toFixed(3), [iscStc]);

  const onRun = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${BACKEND}/api/tests/reverse-current/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isc_stc_a: iscStc,
          duration_s: durationS,
          sample_interval_s: 1.0,
          ambient_target_c: ambientTargetC,
          ambient_tolerance_c: ambientToleranceC,
          abort_temperature_c: abortTempC,
          voltage_clamp_v: voltageClampV,
          hotspot_enabled: hotspotEnabled,
          force_arc_at_s: forceArc === '' ? null : forceArc,
          fast: true,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body}`);
      }
      const json = (await res.json()) as RcoResult;
      setResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [
    iscStc, durationS, ambientTargetC, ambientToleranceC,
    abortTempC, voltageClampV, hotspotEnabled, forceArc,
  ]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6" data-testid="rco-page">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-red-400" data-testid="rco-title">
          Reverse Current Overload — IEC 61730-2 MST 26
        </h1>
        <p className="text-xs text-gray-400 mt-1">
          1.35 × Isc-STC applied in reverse for 2 h. Ambient 30 ± 5 °C.
          Abort on T &gt; 200 °C or arc detection. Post-test: MQT 01 + MQT 15.
        </p>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-3" data-testid="rco-setup">
          <h2 className="text-sm font-bold text-red-300">Setup</h2>
          <NumField label="Isc-STC (A)" value={iscStc} onChange={setIscStc} min={0.1} max={50} step={0.1} testid="isc" />
          <NumField label="Duration (s)" value={durationS} onChange={setDurationS} min={60} max={86400} step={60} testid="duration" />
          <NumField label="Ambient target (°C)" value={ambientTargetC} onChange={setAmbientTargetC} min={-10} max={60} step={1} testid="amb-target" />
          <NumField label="Ambient tolerance (± °C)" value={ambientToleranceC} onChange={setAmbientToleranceC} min={0} max={20} step={0.5} testid="amb-tol" />
          <NumField label="Abort temperature (°C)" value={abortTempC} onChange={setAbortTempC} min={50} max={400} step={5} testid="abort-temp" />
          <NumField label="Voltage clamp (V)" value={voltageClampV} onChange={setVoltageClampV} min={1} max={200} step={1} testid="v-clamp" />
          <label className="flex gap-2 items-center text-xs text-gray-300">
            <input
              type="checkbox"
              checked={hotspotEnabled}
              onChange={e => setHotspotEnabled(e.target.checked)}
              data-testid="hotspot-toggle"
            />
            Simulate hotspot event
          </label>
          <label className="text-xs text-gray-300 block">
            Force arc at t = (s, blank to skip)
            <input
              type="number"
              value={forceArc}
              onChange={e => setForceArc(e.target.value === '' ? '' : Number(e.target.value))}
              className="mt-1 w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs"
              data-testid="force-arc"
            />
          </label>
          <div className="bg-red-900/20 border border-red-700/40 rounded p-3 text-xs text-red-300">
            Test current = {iscStc} × 1.35 = <strong data-testid="test-current">{testCurrent} A</strong> (reverse)
          </div>
          <button
            disabled={running}
            onClick={onRun}
            data-testid="run-button"
            className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded px-3 py-2 text-sm"
          >
            {running ? 'Running…' : 'Run demo'}
          </button>
          {error && (
            <p className="text-xs text-red-400" data-testid="rco-error">
              {error}
            </p>
          )}
        </div>

        <div className="lg:col-span-2 space-y-4">
          <ResultCard result={result} />
          <PostTestStubs result={result} />
        </div>
      </section>
    </div>
  );
}

function NumField({
  label, value, onChange, min, max, step, testid,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step: number;
  testid: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-gray-400">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={e => onChange(Number(e.target.value))}
        data-testid={`field-${testid}`}
        className="mt-1 w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs"
      />
    </label>
  );
}

function ResultCard({ result }: { result: RcoResult | null }) {
  if (!result) {
    return (
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg p-6 text-sm text-gray-500"
        data-testid="rco-empty"
      >
        No run yet. Press “Run demo” to execute the orchestrator in DEMO_MODE.
      </div>
    );
  }
  const verdict = result.analysis.verdict;
  const verdictColor = verdict === 'PASS' ? 'text-green-400' : 'text-red-400';
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4" data-testid="rco-result">
      <div className="flex justify-between items-baseline">
        <h2 className="text-sm font-bold text-gray-200">Result</h2>
        <span className={`text-lg font-bold ${verdictColor}`} data-testid="rco-verdict">
          {verdict}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-gray-300 mt-3">
        <Cell k="Session" v={result.session_id} testid="session-id" />
        <Cell k="Standard" v={result.analysis.standard} testid="std" />
        <Cell k="Abort reason" v={result.abort_reason} testid="abort-reason" />
        <Cell k="Samples" v={result.sample_count.toString()} testid="samples" />
        <Cell k="Duration" v={`${result.duration_s.toFixed(0)} s`} testid="duration-val" />
        <Cell k="Peak surface T" v={`${result.analysis.peak_surface_temperature_c} °C`} testid="peak-surface" />
        <Cell k="Peak J-box T" v={`${result.analysis.peak_jbox_temperature_c} °C`} testid="peak-jbox" />
        <Cell k="Hotspot events" v={result.analysis.hotspot_event_count.toString()} testid="hotspot-count" />
        <Cell k="Ambient in band" v={result.analysis.ambient_in_band ? 'yes' : 'no'} testid="amb-in-band" />
        <Cell k="Test current" v={`${result.analysis.test_current_a} A`} testid="i-test" />
      </dl>
      {result.analysis.failure_reasons.length > 0 && (
        <div className="mt-3 text-xs text-red-300" data-testid="rco-failures">
          Failures: {result.analysis.failure_reasons.join(', ')}
        </div>
      )}
      <h3 className="mt-4 text-xs font-semibold text-gray-200">IEC clauses</h3>
      <ul className="mt-1 text-xs text-gray-400 list-disc pl-5" data-testid="iec-clauses">
        {result.analysis.clauses.map(c => <li key={c}>{c}</li>)}
      </ul>
      <h3 className="mt-4 text-xs font-semibold text-gray-200">Artifacts</h3>
      <ul className="mt-1 text-xs text-gray-400 list-disc pl-5" data-testid="rco-artifacts">
        {result.csv_path && <li>raw CSV: <code className="text-gray-300">{result.csv_path}</code></li>}
        {result.summary_path && <li>summary: <code className="text-gray-300">{result.summary_path}</code></li>}
        {result.hotspot_map_path && <li>hotspot map: <code className="text-gray-300">{result.hotspot_map_path}</code></li>}
      </ul>
      <div className="mt-4 text-xs text-gray-500" data-testid="hotspot-placeholder">
        Hotspot map placeholder — fused with thermal-camera grid when a camera is connected.
      </div>
    </div>
  );
}

function PostTestStubs({ result }: { result: RcoResult | null }) {
  if (!result) return null;
  const stubs = result.analysis.post_test_stubs;
  const keys = Object.keys(stubs);
  if (keys.length === 0) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4" data-testid="rco-post-test">
      <h2 className="text-sm font-bold text-yellow-300">Post-test stubs</h2>
      <ul className="mt-2 space-y-2 text-xs text-gray-300">
        {keys.map(k => (
          <li key={k} className="border border-gray-700 rounded p-2" data-testid={`stub-${k}`}>
            <div className="font-semibold text-gray-100">{k}</div>
            <div className="text-gray-400">{stubs[k].status}</div>
            <div className="text-gray-500 mt-1">{stubs[k].description}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Cell({ k, v, testid }: { k: string; v: string; testid: string }) {
  return (
    <div>
      <dt className="text-gray-500">{k}</dt>
      <dd className="text-gray-200" data-testid={`cell-${testid}`}>{v}</dd>
    </div>
  );
}
