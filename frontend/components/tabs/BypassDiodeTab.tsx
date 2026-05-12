'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play, Square, OctagonAlert, Settings, Activity, Table2, BarChart3, FileText, Loader2,
} from 'lucide-react';
import type { TestSession, LiveReading } from '@/types/test-session';

interface Props {
  readings: LiveReading[];
  session: TestSession | null;
  onSessionUpdate: (s: TestSession | null) => void;
  sendCommand: (cmd: string) => void;
  demoMode: boolean;
}

type SubTab = 'setup' | 'monitor' | 'data' | 'analysis' | 'report';

interface CatalogDiode {
  part_number: string;
  type: string;
  vf_nominal_v: number;
  if_test_a: number;
  tc_vf_mv_per_c: number;
  tj_max_c: number;
  package: string;
}

interface FitResult {
  slope: number;
  intercept: number;
  r_squared: number;
  n: number;
}

interface DiodeCal {
  diode_id: string;
  part_number: string;
  samples: Array<{ T_c: number; Vf_v: number }>;
  fit: FitResult | null;
}

interface PhaseBSample {
  t_s: number;
  current_a: number;
  voltage_v: number;
  chamber_c: number;
}

interface Verdict {
  passed: boolean;
  functionality_pass: boolean;
  summary: string;
  iec_clause: string;
  standard: string;
  failing_diode_ids: string[];
  diodes: Array<{
    diode_id: string;
    part_number: string;
    tj_c: number;
    tj_max_c: number;
    margin_c: number;
    headroom_c: number;
    passed: boolean;
    r_squared: number;
  }>;
}

interface RunResult {
  run_id: string;
  i_test_a: number;
  margin_c: number;
  phase: string;
  diodes: DiodeCal[];
  phase_b: PhaseBSample[];
  vf_hot: Record<string, number>;
  tj: Record<string, number>;
  vf_25c: Record<string, number>;
  functionality: Record<string, boolean>;
  verdict: Verdict | null;
}

const SUB_TABS: Array<{ key: SubTab; label: string; icon: typeof Settings }> = [
  { key: 'setup',    label: 'Setup',        icon: Settings },
  { key: 'monitor',  label: 'Live Monitor', icon: Activity },
  { key: 'data',     label: 'Data Table',   icon: Table2 },
  { key: 'analysis', label: 'Analysis',     icon: BarChart3 },
  { key: 'report',   label: 'Report',       icon: FileText },
];

const DEFAULT_BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

export default function BypassDiodeTab({ readings, session, onSessionUpdate, sendCommand, demoMode }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('setup');

  // Setup
  const [catalog, setCatalog] = useState<CatalogDiode[]>([]);
  const [partNumber, setPartNumber] = useState<string>('SBR10U45SP5');
  const [iTest, setITest] = useState<number>(9.5);
  const [nDiodes, setNDiodes] = useState<number>(3);
  const [ambient, setAmbient] = useState<number>(75);
  const [marginC, setMarginC] = useState<number>(10);
  const [dwellMin, setDwellMin] = useState<number>(15);
  const [aging, setAging] = useState<number>(0);

  // Live state
  const [phase, setPhase] = useState<string>('idle');
  const [phaseBSamples, setPhaseBSamples] = useState<PhaseBSample[]>([]);
  const [calRows, setCalRows] = useState<Array<{ diode_id: string; T_c: number; Vf_v: number }>>([]);
  const [fits, setFits] = useState<Record<string, FitResult>>({});
  const [vfHot, setVfHot] = useState<Record<string, number>>({});
  const [tj, setTj] = useState<Record<string, number>>({});
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${DEFAULT_BACKEND}/api/tests/bypass-diode/catalog`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const items = (data?.diodes ?? []) as CatalogDiode[];
        setCatalog(items);
        if (items.length && !items.some((d) => d.part_number === partNumber)) {
          setPartNumber(items[0].part_number);
          setITest(items[0].if_test_a);
        }
      })
      .catch(() => {
        // Backend may not be running in pure-static preview; keep defaults.
      });
    return () => {
      cancelled = true;
    };
  }, [partNumber]);

  const selected = useMemo(
    () => catalog.find((d) => d.part_number === partNumber) ?? null,
    [catalog, partNumber],
  );

  const reset = () => {
    setPhase('idle');
    setPhaseBSamples([]);
    setCalRows([]);
    setFits({});
    setVfHot({});
    setTj({});
    setResult(null);
    setError(null);
  };

  const onStart = useCallback(() => {
    reset();
    setRunning(true);
    const cfg = {
      part_number: partNumber,
      n_diodes: nDiodes,
      i_test_a: iTest,
      margin_c: marginC,
      ambient_c: ambient,
      aging,
      demo_speedup: demoMode ? 600 : 1,
    };
    sendCommand(`PROG:MQT18:START ${partNumber} ${iTest} ${ambient}`);
    const id = `BDT-${Date.now()}`;
    onSessionUpdate({
      id, testType: 'bypass_diode', startTime: Date.now(), status: 'running',
      readings: [], iecClause: '4.18',
    });
    setSubTab('monitor');

    const wsUrl = DEFAULT_BACKEND.replace(/^http/, 'ws') + '/ws/tests/bypass-diode';
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      setError(`WebSocket open failed: ${(e as Error).message}`);
      setRunning(false);
      return;
    }
    wsRef.current = ws;
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify(cfg));
    });
    ws.addEventListener('message', (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'event') handleEvent(msg);
        else if (msg.type === 'result') {
          setResult(msg.result as RunResult);
          setRunning(false);
          const verdict = msg.result?.verdict as Verdict | null;
          onSessionUpdate({
            id, testType: 'bypass_diode',
            startTime: Date.now(), endTime: Date.now(),
            readings: [],
            status: verdict?.passed ? 'pass' : 'fail',
            result: verdict?.passed ? 'PASS' : 'FAIL',
            iecClause: '4.18',
          });
          setSubTab('analysis');
        }
      } catch {
        /* ignore */
      }
    });
    ws.addEventListener('error', () => setError('WebSocket error'));
    ws.addEventListener('close', () => {
      setRunning(false);
    });

    function handleEvent(msg: Record<string, unknown>) {
      const event = msg.event as string;
      if (event === 'phase') setPhase(msg.phase as string);
      else if (event === 'cal_sample') {
        setCalRows((prev) => [...prev, {
          diode_id: msg.diode_id as string,
          T_c: msg.T_c as number,
          Vf_v: msg.Vf_v as number,
        }]);
      } else if (event === 'cal_fit') {
        setFits((prev) => ({ ...prev, [msg.diode_id as string]: msg.fit as FitResult }));
      } else if (event === 'bias_sample') {
        setPhaseBSamples((prev) => [...prev, {
          t_s: msg.t_s as number,
          current_a: msg.current_a as number,
          voltage_v: msg.voltage_v as number,
          chamber_c: msg.chamber_c as number,
        }]);
      } else if (event === 'tj') {
        const id = msg.diode_id as string;
        setVfHot((prev) => ({ ...prev, [id]: msg.Vf_hot_v as number }));
        setTj((prev) => ({ ...prev, [id]: msg.Tj_c as number }));
      }
    }
  }, [partNumber, iTest, nDiodes, ambient, marginC, aging, demoMode, sendCommand, onSessionUpdate]);

  const onAbort = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'abort' }));
    }
    setRunning(false);
    if (session) onSessionUpdate({ ...session, status: 'aborted', endTime: Date.now() });
  }, [session, onSessionUpdate]);

  const latestVf = phaseBSamples.length > 0
    ? phaseBSamples[phaseBSamples.length - 1].voltage_v
    : readings[readings.length - 1]?.voltage ?? 0;

  return (
    <div className="flex flex-col h-full bg-gray-950">
      <div className="bg-gray-900 border-b border-gray-700 px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-bold text-yellow-400">Bypass Diode Thermal + Functionality</span>
          <span className="text-[10px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded">IEC 61215-2 MQT 18 · cl. 4.18</span>
          {phase !== 'idle' && (
            <span className={`text-xs font-medium ${running ? 'text-green-400 animate-pulse' : 'text-gray-300'}`}>
              ● Phase {phase.toUpperCase()}
            </span>
          )}
          {demoMode && <span className="text-[10px] text-yellow-400 bg-yellow-900/30 px-1.5 py-0.5 rounded">DEMO</span>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button" onClick={onStart} disabled={running}
            data-testid="bdt-start"
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-700 hover:bg-green-600 text-white text-xs rounded font-semibold disabled:opacity-40"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Run Phase A+B+C
          </button>
          <button
            type="button" onClick={onAbort} disabled={!running}
            data-testid="bdt-abort"
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-700 hover:bg-red-600 text-white text-xs rounded font-semibold disabled:opacity-40"
          >
            <Square className="w-3.5 h-3.5" /> Abort
          </button>
          <button
            type="button" onClick={() => sendCommand('OUTP OFF')}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-900 hover:bg-red-800 text-white text-xs rounded font-semibold ring-1 ring-red-500/60"
          >
            <OctagonAlert className="w-3.5 h-3.5" /> E-STOP
          </button>
        </div>
      </div>

      <div className="flex border-b border-gray-800 bg-gray-900 overflow-x-auto">
        {SUB_TABS.map(({ key, label, icon: Icon }) => {
          const active = subTab === key;
          return (
            <button
              key={key} type="button"
              onClick={() => setSubTab(key)}
              data-testid={`bdt-tab-${key}`}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors border-b-2 ${
                active
                  ? 'border-orange-400 text-white bg-gray-800/50'
                  : 'border-transparent text-gray-500 hover:text-gray-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {error && (
          <div className="mb-3 bg-red-900/30 border border-red-700/50 rounded p-3 text-xs text-red-300">
            {error}
          </div>
        )}

        {subTab === 'setup' && (
          <SetupPanel
            catalog={catalog}
            selected={selected}
            partNumber={partNumber} setPartNumber={setPartNumber}
            iTest={iTest} setITest={setITest}
            nDiodes={nDiodes} setNDiodes={setNDiodes}
            ambient={ambient} setAmbient={setAmbient}
            marginC={marginC} setMarginC={setMarginC}
            dwellMin={dwellMin} setDwellMin={setDwellMin}
            aging={aging} setAging={setAging}
          />
        )}

        {subTab === 'monitor' && (
          <MonitorPanel
            phase={phase}
            iTest={iTest}
            ambient={ambient}
            latestVf={latestVf}
            phaseBSamples={phaseBSamples}
          />
        )}

        {subTab === 'data' && (
          <DataPanel
            calRows={calRows}
            fits={fits}
            phaseBSamples={phaseBSamples}
            tj={tj}
            vfHot={vfHot}
          />
        )}

        {subTab === 'analysis' && (
          <AnalysisPanel
            fits={fits}
            calRows={calRows}
            tj={tj}
            vfHot={vfHot}
            result={result}
            selected={selected}
            marginC={marginC}
          />
        )}

        {subTab === 'report' && (
          <ReportPanel
            result={result}
            selected={selected}
            iTest={iTest}
            ambient={ambient}
            marginC={marginC}
            calRows={calRows}
            fits={fits}
            phaseBSamples={phaseBSamples}
          />
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ subpanels

function SetupPanel(props: {
  catalog: CatalogDiode[]; selected: CatalogDiode | null;
  partNumber: string; setPartNumber: (s: string) => void;
  iTest: number; setITest: (n: number) => void;
  nDiodes: number; setNDiodes: (n: number) => void;
  ambient: number; setAmbient: (n: number) => void;
  marginC: number; setMarginC: (n: number) => void;
  dwellMin: number; setDwellMin: (n: number) => void;
  aging: number; setAging: (n: number) => void;
}) {
  const {
    catalog, selected, partNumber, setPartNumber, iTest, setITest, nDiodes, setNDiodes,
    ambient, setAmbient, marginC, setMarginC, dwellMin, setDwellMin, aging, setAging,
  } = props;
  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-bold text-yellow-400 mb-3">IEC 61215-2 MQT 18 — Bypass Diode (clause 4.18)</h3>
        <p className="text-xs text-gray-400 mb-4">
          Two-phase method per the 2021 revision. <b>Phase A</b> calibrates Vf vs T per diode at seven setpoints
          using sub-millisecond pulses to keep self-heating negligible.
          <b> Phase B</b> applies a continuous I<sub>test</sub> for 1 hour at {ambient}&nbsp;°C ambient, then a brief
          pulse captures V<sub>f,hot</sub>; junction temperature is recovered as
          T<sub>j</sub> = (V<sub>f,hot</sub> &minus; c) / m. <b>Phase C</b> verifies functionality at 25&nbsp;°C.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1" htmlFor="bdt-part">Diode part number</label>
            <select
              id="bdt-part"
              data-testid="bdt-part"
              value={partNumber}
              onChange={(e) => setPartNumber(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200"
            >
              {catalog.length === 0 && <option value={partNumber}>{partNumber}</option>}
              {catalog.map((d) => (
                <option key={d.part_number} value={d.part_number}>
                  {d.part_number} — Tj_max {d.tj_max_c}°C
                </option>
              ))}
            </select>
          </div>

          {[
            { id: 'itest',   label: 'Itest (A) — default Isc-STC',   value: iTest,    set: setITest,    min: 0.1, max: 50, step: 0.1, unit: 'A' },
            { id: 'ndiodes', label: 'Number of diodes',              value: nDiodes,  set: setNDiodes,  min: 1,   max: 6,  step: 1,   unit: '' },
            { id: 'ambient', label: 'Ambient temperature',           value: ambient,  set: setAmbient,  min: 20,  max: 85, step: 1,   unit: '°C' },
            { id: 'margin',  label: 'Tj margin below Tj_max',        value: marginC,  set: setMarginC,  min: 0,   max: 30, step: 1,   unit: '°C' },
            { id: 'dwell',   label: 'Calibration dwell',             value: dwellMin, set: setDwellMin, min: 1,   max: 60, step: 1,   unit: 'min' },
            { id: 'aging',   label: 'Demo aging factor (0=new)',     value: aging,    set: setAging,    min: 0,   max: 1,  step: 0.05, unit: '' },
          ].map(f => (
            <div key={f.id}>
              <label className="text-xs text-gray-400 block mb-1" htmlFor={`bdt-${f.id}`}>{f.label}</label>
              <div className="flex gap-2 items-center">
                <input
                  id={`bdt-${f.id}`}
                  data-testid={`bdt-${f.id}`}
                  type="number" value={f.value} min={f.min} max={f.max} step={f.step}
                  onChange={(e) => f.set(Number(e.target.value))}
                  className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200"
                />
                <span className="text-xs text-gray-500 w-12">{f.unit}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
          <h4 className="text-xs font-bold text-gray-200 mb-2">Datasheet snapshot</h4>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-300">
            <dt className="text-gray-500">Type</dt><dd>{selected.type}</dd>
            <dt className="text-gray-500">Vf nominal @ {selected.if_test_a}A</dt><dd>{selected.vf_nominal_v.toFixed(3)} V</dd>
            <dt className="text-gray-500">dVf/dT typical</dt><dd>{selected.tc_vf_mv_per_c.toFixed(2)} mV/°C</dd>
            <dt className="text-gray-500">Tj_max</dt><dd>{selected.tj_max_c.toFixed(0)} °C</dd>
            <dt className="text-gray-500">Package</dt><dd>{selected.package}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}

function MonitorPanel({
  phase, iTest, ambient, latestVf, phaseBSamples,
}: {
  phase: string;
  iTest: number;
  ambient: number;
  latestVf: number;
  phaseBSamples: PhaseBSample[];
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Gauge label="Phase" value={phase.toUpperCase()} color="text-yellow-400" />
        <Gauge label="Current" value={`${iTest.toFixed(2)} A`} color="text-green-400" />
        <Gauge label="Vf (string)" value={`${latestVf.toFixed(3)} V`} color="text-blue-400" />
        <Gauge label="Chamber T" value={`${ambient.toFixed(1)} °C`} color="text-red-400" />
      </div>

      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h4 className="text-xs font-bold text-gray-200 mb-3">Phase B — 1 h current bias (live)</h4>
        <PhaseBTimeSeries samples={phaseBSamples} />
      </div>
    </div>
  );
}

function Gauge({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-gray-900 rounded-lg p-3 border border-gray-700">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-mono font-bold ${color}`}>{value}</p>
    </div>
  );
}

function PhaseBTimeSeries({ samples }: { samples: PhaseBSample[] }) {
  const w = 720, h = 220;
  if (samples.length === 0) {
    return <p className="text-xs text-gray-500">No Phase B samples yet — start the run to populate.</p>;
  }
  const ts = samples.map((s) => s.t_s);
  const vs = samples.map((s) => s.voltage_v);
  const tMin = Math.min(...ts), tMax = Math.max(...ts);
  const vMin = Math.min(...vs), vMax = Math.max(...vs);
  const padL = 50, padR = 12, padT = 12, padB = 24;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const xy = samples.map((s) => {
    const x = padL + ((s.t_s - tMin) / Math.max(1, tMax - tMin)) * plotW;
    const y = padT + plotH - ((s.voltage_v - vMin) / Math.max(1e-9, vMax - vMin)) * plotH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} className="bg-gray-950 rounded">
      <rect x="0" y="0" width={w} height={h} fill="#0b1020" />
      <polyline fill="none" stroke="#f59e0b" strokeWidth="1.5" points={xy} />
      <text x={padL} y={padT - 2} fill="#9ca3af" fontSize="10">
        Vf string (V) vs t (s)
      </text>
      <text x={padL} y={h - 6} fill="#9ca3af" fontSize="10">0 s</text>
      <text x={padL + plotW - 40} y={h - 6} fill="#9ca3af" fontSize="10">{tMax.toFixed(0)} s</text>
    </svg>
  );
}

function DataPanel({
  calRows, fits, phaseBSamples, tj, vfHot,
}: {
  calRows: Array<{ diode_id: string; T_c: number; Vf_v: number }>;
  fits: Record<string, FitResult>;
  phaseBSamples: PhaseBSample[];
  tj: Record<string, number>;
  vfHot: Record<string, number>;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h4 className="text-xs font-bold text-gray-200 mb-3">Phase A — calibration samples</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-gray-300">
            <thead className="text-gray-500 border-b border-gray-700">
              <tr><th className="text-left py-1">Diode</th><th className="text-left py-1">T (°C)</th><th className="text-left py-1">Vf (V)</th></tr>
            </thead>
            <tbody className="font-mono">
              {calRows.map((r, i) => (
                <tr key={i} className="border-b border-gray-800">
                  <td className="py-1">{r.diode_id}</td>
                  <td className="py-1">{r.T_c.toFixed(1)}</td>
                  <td className="py-1">{r.Vf_v.toFixed(4)}</td>
                </tr>
              ))}
              {calRows.length === 0 && (
                <tr><td colSpan={3} className="py-2 text-gray-500">No calibration data yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h4 className="text-xs font-bold text-gray-200 mb-3">Per-diode linear fit</h4>
        <table className="w-full text-xs text-gray-300">
          <thead className="text-gray-500 border-b border-gray-700">
            <tr>
              <th className="text-left py-1">Diode</th>
              <th className="text-left py-1">m (mV/°C)</th>
              <th className="text-left py-1">c (V)</th>
              <th className="text-left py-1">R²</th>
              <th className="text-left py-1">Vf_hot (V)</th>
              <th className="text-left py-1">Tj (°C)</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {Object.entries(fits).map(([id, f]) => {
              const r2bad = f.r_squared < 0.95;
              return (
                <tr key={id} className="border-b border-gray-800">
                  <td className="py-1">{id}</td>
                  <td className="py-1">{(f.slope * 1000).toFixed(3)}</td>
                  <td className="py-1">{f.intercept.toFixed(4)}</td>
                  <td className={`py-1 ${r2bad ? 'text-red-400' : 'text-green-400'}`}>
                    {f.r_squared.toFixed(4)}
                  </td>
                  <td className="py-1">{vfHot[id]?.toFixed(4) ?? '—'}</td>
                  <td className="py-1">{tj[id]?.toFixed(1) ?? '—'}</td>
                </tr>
              );
            })}
            {Object.keys(fits).length === 0 && (
              <tr><td colSpan={6} className="py-2 text-gray-500">Run Phase A to produce fits.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <p className="text-xs text-gray-500">
          Phase B samples: <span className="text-gray-300 font-mono">{phaseBSamples.length}</span>
        </p>
      </div>
    </div>
  );
}

function AnalysisPanel({
  fits, calRows, tj, vfHot, result, selected, marginC,
}: {
  fits: Record<string, FitResult>;
  calRows: Array<{ diode_id: string; T_c: number; Vf_v: number }>;
  tj: Record<string, number>;
  vfHot: Record<string, number>;
  result: RunResult | null;
  selected: CatalogDiode | null;
  marginC: number;
}) {
  const verdict = result?.verdict ?? null;
  return (
    <div className="space-y-4">
      <FitScatterPlot calRows={calRows} fits={fits} />

      {verdict && (
        <div
          data-testid="bdt-verdict-card"
          className={`rounded-lg border p-4 ${
            verdict.passed ? 'bg-green-900/20 border-green-700/50' : 'bg-red-900/20 border-red-700/50'
          }`}
        >
          <h4 className={`text-sm font-bold ${verdict.passed ? 'text-green-400' : 'text-red-400'}`}>
            {verdict.passed ? 'PASS' : 'FAIL'} — IEC 61215-2 MQT 18 (clause {verdict.iec_clause})
          </h4>
          <p className="text-xs text-gray-300 mt-1">{verdict.summary}</p>
        </div>
      )}

      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h4 className="text-xs font-bold text-gray-200 mb-3">
          Tj computation per diode (Tj_max = {selected?.tj_max_c.toFixed(0) ?? '—'} °C, margin = {marginC} °C)
        </h4>
        <table className="w-full text-xs text-gray-300">
          <thead className="text-gray-500 border-b border-gray-700">
            <tr>
              <th className="text-left py-1">Diode</th>
              <th className="text-left py-1">Vf_hot (V)</th>
              <th className="text-left py-1">Tj (°C)</th>
              <th className="text-left py-1">Tj_max (°C)</th>
              <th className="text-left py-1">Headroom (°C)</th>
              <th className="text-left py-1">Verdict</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {(verdict?.diodes ?? Object.keys(fits).map((id) => ({
              diode_id: id, part_number: selected?.part_number ?? '',
              tj_c: tj[id] ?? Number.NaN, tj_max_c: selected?.tj_max_c ?? Number.NaN,
              margin_c: marginC, headroom_c: (selected?.tj_max_c ?? 0) - marginC - (tj[id] ?? 0),
              passed: ((selected?.tj_max_c ?? 0) - marginC - (tj[id] ?? 0)) >= 0,
              r_squared: fits[id]?.r_squared ?? Number.NaN,
            }))).map((d) => (
              <tr key={d.diode_id} className="border-b border-gray-800">
                <td className="py-1">{d.diode_id}</td>
                <td className="py-1">{vfHot[d.diode_id]?.toFixed(4) ?? '—'}</td>
                <td className="py-1">{Number.isFinite(d.tj_c) ? d.tj_c.toFixed(1) : '—'}</td>
                <td className="py-1">{Number.isFinite(d.tj_max_c) ? d.tj_max_c.toFixed(0) : '—'}</td>
                <td className={`py-1 ${d.headroom_c >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {Number.isFinite(d.headroom_c) ? d.headroom_c.toFixed(1) : '—'}
                </td>
                <td className={`py-1 font-bold ${d.passed ? 'text-green-400' : 'text-red-400'}`}>
                  {d.passed ? 'PASS' : 'FAIL'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FitScatterPlot({
  calRows, fits,
}: {
  calRows: Array<{ diode_id: string; T_c: number; Vf_v: number }>;
  fits: Record<string, FitResult>;
}) {
  const w = 720, h = 280;
  if (calRows.length === 0) {
    return (
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <p className="text-xs text-gray-500">No calibration data yet.</p>
      </div>
    );
  }
  const ts = calRows.map((r) => r.T_c);
  const vs = calRows.map((r) => r.Vf_v);
  const tMin = Math.min(...ts), tMax = Math.max(...ts);
  const vMin = Math.min(...vs), vMax = Math.max(...vs);
  const padL = 50, padR = 12, padT = 16, padB = 28;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const colors = ['#60a5fa', '#34d399', '#f87171', '#fbbf24', '#a78bfa', '#22d3ee'];
  const ids = Array.from(new Set(calRows.map((r) => r.diode_id)));

  const xOf = (t: number) => padL + ((t - tMin) / Math.max(1, tMax - tMin)) * plotW;
  const yOf = (v: number) => padT + plotH - ((v - vMin) / Math.max(1e-9, vMax - vMin)) * plotH;

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
      <h4 className="text-xs font-bold text-gray-200 mb-2">Phase A — Vf vs T scatter with linear fit</h4>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} className="bg-gray-950 rounded">
        <rect x="0" y="0" width={w} height={h} fill="#0b1020" />
        <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="#374151" />
        <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke="#374151" />
        {ids.map((id, k) => {
          const color = colors[k % colors.length];
          const pts = calRows.filter((r) => r.diode_id === id);
          const fit = fits[id];
          return (
            <g key={id}>
              {pts.map((p, i) => (
                <circle key={i} cx={xOf(p.T_c)} cy={yOf(p.Vf_v)} r="3" fill={color} />
              ))}
              {fit && (
                <line
                  x1={xOf(tMin)} y1={yOf(fit.slope * tMin + fit.intercept)}
                  x2={xOf(tMax)} y2={yOf(fit.slope * tMax + fit.intercept)}
                  stroke={color} strokeWidth="1.5" strokeDasharray="4 3"
                />
              )}
              <text x={padL + plotW - 12 - (k * 60)} y={padT + 4} fill={color} fontSize="10">
                {id}
              </text>
            </g>
          );
        })}
        <text x={padL} y={h - 8} fill="#9ca3af" fontSize="10">{tMin.toFixed(0)}°C</text>
        <text x={padL + plotW - 30} y={h - 8} fill="#9ca3af" fontSize="10">{tMax.toFixed(0)}°C</text>
        <text x={4} y={padT + 10} fill="#9ca3af" fontSize="10">Vf (V)</text>
      </svg>
    </div>
  );
}

function ReportPanel(props: {
  result: RunResult | null;
  selected: CatalogDiode | null;
  iTest: number;
  ambient: number;
  marginC: number;
  calRows: Array<{ diode_id: string; T_c: number; Vf_v: number }>;
  fits: Record<string, FitResult>;
  phaseBSamples: PhaseBSample[];
}) {
  const { result, selected, iTest, ambient, marginC, calRows, fits, phaseBSamples } = props;
  const [busy, setBusy] = useState(false);
  const [operator, setOperator] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [notes, setNotes] = useState('');

  const generate = useCallback(async () => {
    setBusy(true);
    try {
      const { default: jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');
      const doc = new jsPDF();
      const pageW = doc.internal.pageSize.getWidth();

      // Header
      doc.setFillColor(17, 24, 39); doc.rect(0, 0, pageW, 36, 'F');
      doc.setTextColor(255, 165, 0); doc.setFontSize(18); doc.setFont('helvetica', 'bold');
      doc.text('AGNIPARIKSHA — MQT 18 Bypass Diode Report', 14, 16);
      doc.setTextColor(200, 200, 200); doc.setFontSize(10); doc.setFont('helvetica', 'normal');
      doc.text('IEC 61215-2 clause 4.18 — Thermal + Functionality', 14, 24);

      doc.setTextColor(0, 0, 0); doc.setFontSize(11);
      autoTable(doc, {
        startY: 44,
        head: [['Parameter', 'Value']],
        body: [
          ['Standard / Clause', 'IEC 61215-2 MQT 18 / clause 4.18'],
          ['Diode part number', selected?.part_number ?? '—'],
          ['Diode Tj_max (°C)', selected?.tj_max_c.toFixed(0) ?? '—'],
          ['Test current Itest (A)', iTest.toFixed(3)],
          ['Phase B ambient (°C)', ambient.toFixed(1)],
          ['Tj margin (°C)', marginC.toString()],
          ['Run ID', result?.run_id ?? 'pending'],
          ['Module ID', moduleId || 'N/A'],
          ['Operator', operator || 'N/A'],
          ['Date', new Date().toLocaleString()],
        ],
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [17, 24, 39], textColor: [255, 165, 0] },
      });

      // Calibration table with R^2
      const fitFinalY1 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text('Phase A — per-diode Vf(T) linear fit', 14, fitFinalY1);
      autoTable(doc, {
        startY: fitFinalY1 + 3,
        head: [['Diode', 'm (mV/°C)', 'c (V)', 'R²', 'Samples']],
        body: Object.entries(fits).map(([id, f]) => [
          id,
          (f.slope * 1000).toFixed(3),
          f.intercept.toFixed(4),
          f.r_squared.toFixed(4),
          f.n.toString(),
        ]),
        styles: { fontSize: 9, cellPadding: 2.5 },
        headStyles: { fillColor: [17, 24, 39], textColor: [255, 165, 0] },
      });

      // Scatter PNG
      const scatter = await renderScatterPng(calRows, fits);
      if (scatter) {
        const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
        doc.setFont('helvetica', 'bold');
        doc.text('Calibration scatter + linear fit', 14, y);
        doc.addImage(scatter, 'PNG', 14, y + 3, pageW - 28, 60);
      }

      // Residuals PNG
      const residuals = await renderResidualsPng(calRows, fits);
      if (residuals) {
        const y2 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 80;
        doc.setFont('helvetica', 'bold');
        doc.text('Residuals (Vf - fit) vs T', 14, y2);
        doc.addImage(residuals, 'PNG', 14, y2 + 3, pageW - 28, 50);
      }

      doc.addPage();

      // Phase B time-series
      const ts = await renderPhaseBPng(phaseBSamples);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text('Phase B — 1 h current bias (V_f string vs time)', 14, 18);
      if (ts) doc.addImage(ts, 'PNG', 14, 22, pageW - 28, 60);

      // Tj table
      const tjStart = 92;
      doc.setFont('helvetica', 'bold');
      doc.text('Tj computation per diode', 14, tjStart);
      autoTable(doc, {
        startY: tjStart + 3,
        head: [['Diode', 'Vf_hot (V)', 'Tj (°C)', 'Tj_max (°C)', 'Margin (°C)', 'Headroom (°C)', 'Verdict']],
        body: (result?.verdict?.diodes ?? []).map((d) => [
          d.diode_id,
          (result?.vf_hot?.[d.diode_id] ?? 0).toFixed(4),
          d.tj_c.toFixed(1),
          d.tj_max_c.toFixed(0),
          d.margin_c.toFixed(1),
          d.headroom_c.toFixed(1),
          d.passed ? 'PASS' : 'FAIL',
        ]),
        styles: { fontSize: 9, cellPadding: 2.5 },
        headStyles: { fillColor: [17, 24, 39], textColor: [255, 165, 0] },
      });

      // Datasheet comparison
      const dsY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
      doc.setFont('helvetica', 'bold');
      doc.text('Datasheet comparison', 14, dsY);
      autoTable(doc, {
        startY: dsY + 3,
        head: [['Parameter', 'Datasheet', 'Measured (avg)']],
        body: [
          ['Vf nominal (V)', selected?.vf_nominal_v.toFixed(3) ?? '—', avgIntercept(fits).toFixed(3)],
          ['dVf/dT (mV/°C)', selected?.tc_vf_mv_per_c.toFixed(2) ?? '—', avgSlopeMv(fits).toFixed(2)],
          ['Tj_max (°C)',    selected?.tj_max_c.toFixed(0) ?? '—',      maxTj(result).toFixed(1)],
        ],
        styles: { fontSize: 9, cellPadding: 2.5 },
        headStyles: { fillColor: [17, 24, 39], textColor: [255, 165, 0] },
      });

      // Pass / fail summary band
      const summaryY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
      const passed = result?.verdict?.passed ?? false;
      doc.setFillColor(passed ? 21 : 185, passed ? 128 : 28, passed ? 61 : 28);
      doc.rect(14, summaryY, pageW - 28, 14, 'F');
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
      doc.text(
        `${passed ? 'PASS' : 'FAIL'} — ${result?.verdict?.summary ?? 'No result yet.'}`,
        18, summaryY + 9,
      );

      // Reference + raw path
      doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.text(
        `IEC 61215-2 clause 4.18 — Bypass Diode Thermal and Functionality. Raw CSV: data/calibration/bypass_diode/${result?.run_id ?? 'pending'}.json`,
        14, summaryY + 22, { maxWidth: pageW - 28 },
      );

      if (notes) {
        doc.setFont('helvetica', 'bold'); doc.text('Notes', 14, summaryY + 34);
        doc.setFont('helvetica', 'normal');
        doc.text(notes, 14, summaryY + 40, { maxWidth: pageW - 28 });
      }

      doc.save(`MQT18_BypassDiode_${result?.run_id ?? Date.now()}.pdf`);
    } catch (e) {
      console.error(e);
    }
    setBusy(false);
  }, [result, selected, iTest, ambient, marginC, calRows, fits, phaseBSamples, operator, moduleId, notes]);

  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4 space-y-3">
        <h3 className="text-sm font-bold text-gray-200">MQT 18 Report</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Module ID" value={moduleId} set={setModuleId} />
          <Field label="Operator" value={operator} set={setOperator} />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Notes</label>
          <textarea
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200"
            rows={3}
            value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Operator observations, deviations, etc."
          />
        </div>
      </div>
      <button
        type="button" onClick={generate} disabled={busy}
        data-testid="bdt-generate-pdf"
        className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded font-semibold disabled:opacity-40 inline-flex items-center gap-2"
      >
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        Generate MQT 18 PDF report
      </button>
    </div>
  );
}

function Field({ label, value, set }: { label: string; value: string; set: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs text-gray-400 block mb-1">{label}</label>
      <input
        type="text" value={value} onChange={(e) => set(e.target.value)}
        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200"
      />
    </div>
  );
}

// ---------------------------------------------------------------- PDF helpers

async function renderScatterPng(
  calRows: Array<{ diode_id: string; T_c: number; Vf_v: number }>,
  fits: Record<string, FitResult>,
): Promise<string | null> {
  if (typeof document === 'undefined' || calRows.length === 0) return null;
  const w = 720, h = 280;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  const ts = calRows.map((r) => r.T_c);
  const vs = calRows.map((r) => r.Vf_v);
  const tMin = Math.min(...ts), tMax = Math.max(...ts);
  const vMin = Math.min(...vs), vMax = Math.max(...vs);
  const padL = 60, padR = 20, padT = 20, padB = 30;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const xOf = (t: number) => padL + ((t - tMin) / Math.max(1, tMax - tMin)) * plotW;
  const yOf = (v: number) => padT + plotH - ((v - vMin) / Math.max(1e-9, vMax - vMin)) * plotH;

  ctx.strokeStyle = '#374151'; ctx.beginPath();
  ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + plotH); ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();
  ctx.fillStyle = '#111827'; ctx.font = 'bold 12px Helvetica';
  ctx.fillText('Vf (V) vs Chamber T (°C)', padL, 14);

  const ids = Array.from(new Set(calRows.map((r) => r.diode_id)));
  const colors = ['#2563eb', '#059669', '#dc2626', '#d97706', '#7c3aed'];
  ids.forEach((id, k) => {
    const color = colors[k % colors.length];
    ctx.fillStyle = color;
    calRows.filter((r) => r.diode_id === id).forEach((p) => {
      ctx.beginPath(); ctx.arc(xOf(p.T_c), yOf(p.Vf_v), 3, 0, Math.PI * 2); ctx.fill();
    });
    const fit = fits[id];
    if (fit) {
      ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(xOf(tMin), yOf(fit.slope * tMin + fit.intercept));
      ctx.lineTo(xOf(tMax), yOf(fit.slope * tMax + fit.intercept));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });
  return canvas.toDataURL('image/png');
}

async function renderResidualsPng(
  calRows: Array<{ diode_id: string; T_c: number; Vf_v: number }>,
  fits: Record<string, FitResult>,
): Promise<string | null> {
  if (typeof document === 'undefined' || calRows.length === 0) return null;
  const w = 720, h = 220;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  const residuals = calRows
    .filter((r) => fits[r.diode_id])
    .map((r) => ({
      ...r,
      res: r.Vf_v - (fits[r.diode_id].slope * r.T_c + fits[r.diode_id].intercept),
    }));
  if (residuals.length === 0) return null;
  const ts = residuals.map((r) => r.T_c);
  const rs = residuals.map((r) => r.res);
  const tMin = Math.min(...ts), tMax = Math.max(...ts);
  const rMin = Math.min(...rs, 0), rMax = Math.max(...rs, 0);
  const padL = 60, padR = 20, padT = 20, padB = 30;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const xOf = (t: number) => padL + ((t - tMin) / Math.max(1, tMax - tMin)) * plotW;
  const yOf = (r: number) => padT + plotH - ((r - rMin) / Math.max(1e-9, rMax - rMin)) * plotH;
  ctx.fillStyle = '#111827'; ctx.font = 'bold 12px Helvetica';
  ctx.fillText('Residual Vf - fit (V) vs T (°C)', padL, 14);
  ctx.strokeStyle = '#374151'; ctx.beginPath();
  ctx.moveTo(padL, yOf(0)); ctx.lineTo(padL + plotW, yOf(0)); ctx.stroke();
  const ids = Array.from(new Set(residuals.map((r) => r.diode_id)));
  const colors = ['#2563eb', '#059669', '#dc2626', '#d97706', '#7c3aed'];
  ids.forEach((id, k) => {
    ctx.fillStyle = colors[k % colors.length];
    residuals.filter((r) => r.diode_id === id).forEach((p) => {
      ctx.beginPath(); ctx.arc(xOf(p.T_c), yOf(p.res), 3, 0, Math.PI * 2); ctx.fill();
    });
  });
  return canvas.toDataURL('image/png');
}

async function renderPhaseBPng(samples: PhaseBSample[]): Promise<string | null> {
  if (typeof document === 'undefined' || samples.length === 0) return null;
  const w = 720, h = 220;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  const ts = samples.map((s) => s.t_s);
  const vs = samples.map((s) => s.voltage_v);
  const tMax = Math.max(...ts);
  const vMin = Math.min(...vs), vMax = Math.max(...vs);
  const padL = 60, padR = 20, padT = 20, padB = 30;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const xOf = (t: number) => padL + (t / Math.max(1, tMax)) * plotW;
  const yOf = (v: number) => padT + plotH - ((v - vMin) / Math.max(1e-9, vMax - vMin)) * plotH;
  ctx.fillStyle = '#111827'; ctx.font = 'bold 12px Helvetica';
  ctx.fillText('Vf string (V) vs Time (s)', padL, 14);
  ctx.strokeStyle = '#374151'; ctx.beginPath();
  ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + plotH); ctx.lineTo(padL + plotW, padT + plotH); ctx.stroke();
  ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 1.4; ctx.beginPath();
  samples.forEach((s, i) => {
    const x = xOf(s.t_s), y = yOf(s.voltage_v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  return canvas.toDataURL('image/png');
}

function avgSlopeMv(fits: Record<string, FitResult>): number {
  const xs = Object.values(fits).map((f) => f.slope * 1000);
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function avgIntercept(fits: Record<string, FitResult>): number {
  const xs = Object.values(fits).map((f) => f.intercept);
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function maxTj(result: RunResult | null): number {
  if (!result?.tj) return 0;
  const vs = Object.values(result.tj);
  return vs.length === 0 ? 0 : Math.max(...vs);
}
