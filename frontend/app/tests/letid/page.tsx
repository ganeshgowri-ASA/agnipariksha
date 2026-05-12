'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LineChart, Line, CartesianGrid, XAxis, YAxis,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';
const WS_BACKEND = BACKEND.replace(/^http/, 'ws');

type IVPoint = {
  elapsed_h: number;
  dose_sun_h: number;
  pmpp: number;
  voc: number;
  isc: number;
  vmpp: number;
  impp: number;
  fill_factor: number;
  temperature_c: number;
};

type EnvSample = {
  timestamp_ms: number;
  elapsed_h: number;
  voltage: number;
  current: number;
  power: number;
  temperature_c: number;
  in_tolerance: boolean;
};

type Fit = {
  p0: number;
  amp_degrade: number;
  tau_degrade_h: number;
  amp_regen: number;
  tau_regen_h: number;
  rmse: number;
  n_points: number;
};

type Summary = {
  session_id: string;
  passed: boolean;
  max_relative_loss_pct: number;
  time_to_min_h: number;
  regeneration_fraction: number;
  final_dose_sun_h: number;
  final_elapsed_h: number;
  n_iv_points: number;
  n_env_samples: number;
  csv_path: string | null;
  report_path: string | null;
  fit: Fit | null;
  notes: string[];
};

const CLAUSE_REFS: Array<{ id: string; text: string }> = [
  { id: 'stress_procedure', text: 'IEC TS 63342:2022 §6.2 — current injection at 75 ± 5 °C' },
  { id: 'iv_interrupts',    text: 'IEC TS 63342:2022 §6.4 — periodic STC IV measurement' },
  { id: 'duration',         text: 'IEC TS 63342:2022 §6.3 — 162 h minimum cumulative stress' },
  { id: 'acceptance',       text: 'IEC TS 63342:2022 §7.2 — Pmax loss threshold (default 2 %)' },
  { id: 'regeneration',     text: 'IEC TS 63342:2022 Annex A — regeneration tracking' },
];

export default function LeTIDPage(): React.JSX.Element {
  const [form, setForm] = useState({
    isc_stc: 9.5,
    impp_stc: 8.9,
    vmpp_stc: 37.5,
    voc_stc: 45.0,
    temperature_c: 75.0,
    total_duration_h: 162.0,
    iv_interval_h: 24.0,
    telemetry_interval_s: 5.0,
    max_allowed_loss_pct: 2.0,
    drift_alarm_pct: 0.5,
    demo_mode: true,
  });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [iv, setIv] = useState<IVPoint[]>([]);
  const [env, setEnv] = useState<EnvSample[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const pushEvent = useCallback((line: string) => {
    setEvents(e => [...e.slice(-99), `[${new Date().toLocaleTimeString()}] ${line}`]);
  }, []);

  const connectWs = useCallback((sid: string) => {
    wsRef.current?.close();
    const ws = new WebSocket(`${WS_BACKEND}/ws/letid/${sid}`);
    wsRef.current = ws;
    ws.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data);
        if (ev.type === 'iv_point') {
          setIv(prev => [...prev, ev as IVPoint]);
          pushEvent(`IV @ ${(ev.elapsed_h as number).toFixed(2)}h — Pmpp=${(ev.pmpp as number).toFixed(2)}W`);
        } else if (ev.type === 'env_sample') {
          setEnv(prev => {
            const next = [...prev, ev as EnvSample];
            return next.length > 4096 ? next.slice(-2048) : next;
          });
        } else if (ev.type === 'stress_start') {
          pushEvent(`stress start — Iinj=${(ev.injection_current_a as number).toFixed(3)} A`);
        } else if (ev.type === 'stress_complete') {
          pushEvent('stress complete');
        } else if (ev.type === 'analysis') {
          setSummary(ev as Summary);
          setRunning(false);
          pushEvent(`analysis: ${ev.passed ? 'PASS' : 'FAIL'} — ΔPmax = ${(ev.max_relative_loss_pct as number).toFixed(3)} %`);
        }
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => { /* allow reconnect on demand */ };
  }, [pushEvent]);

  const onStart = useCallback(async () => {
    setIv([]); setEnv([]); setSummary(null); setEvents([]);
    const res = await fetch(`${BACKEND}/api/tests/letid/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });
    const body = await res.json();
    if (!body.session_id) {
      pushEvent(`start failed: ${JSON.stringify(body)}`);
      return;
    }
    setSessionId(body.session_id);
    setRunning(true);
    pushEvent(`started ${body.session_id}`);
    connectWs(body.session_id);
  }, [form, connectWs, pushEvent]);

  const onStop = useCallback(async () => {
    if (!sessionId) return;
    const res = await fetch(`${BACKEND}/api/tests/letid/${sessionId}/stop`, { method: 'POST' });
    const body = await res.json();
    if (body.summary) setSummary(body.summary);
    setRunning(false);
    pushEvent('stop requested');
  }, [sessionId, pushEvent]);

  const onPause = useCallback(async () => {
    if (!sessionId) return;
    await fetch(`${BACKEND}/api/tests/letid/${sessionId}/pause`, { method: 'POST' });
    pushEvent('paused');
  }, [sessionId, pushEvent]);

  const onResume = useCallback(async () => {
    if (!sessionId) return;
    await fetch(`${BACKEND}/api/tests/letid/${sessionId}/resume`, { method: 'POST' });
    pushEvent('resumed');
  }, [sessionId, pushEvent]);

  useEffect(() => () => wsRef.current?.close(), []);

  const curveData = useMemo(() => {
    if (iv.length === 0) return [] as Array<IVPoint & { fit?: number }>;
    const fit = summary?.fit;
    return iv.map(p => {
      const t = p.elapsed_h;
      let yhat: number | undefined;
      if (fit) {
        const d = fit.amp_degrade * (1 - Math.exp(-t / Math.max(fit.tau_degrade_h, 1e-6)));
        const r = fit.amp_regen   * (1 - Math.exp(-t / Math.max(fit.tau_regen_h,   1e-6)));
        yhat = fit.p0 * (1 - d + r);
      }
      return { ...p, fit: yhat };
    });
  }, [iv, summary]);

  const minPmpp = useMemo(() => iv.reduce((m, p) => p.pmpp < m ? p.pmpp : m, Infinity), [iv]);
  const p0 = iv[0]?.pmpp ?? 0;
  const liveLossPct = (p0 > 0 && Number.isFinite(minPmpp)) ? ((p0 - minPmpp) / p0) * 100 : 0;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 data-testid="letid-title" className="text-2xl font-bold text-purple-400">
            LeTID — IEC TS 63342:2022
          </h1>
          <p className="text-sm text-gray-400">
            Light and elevated Temperature Induced Degradation — current-injection stress at 75 ± 5 °C.
          </p>
        </div>
        <a href="/" className="text-xs text-gray-400 hover:text-gray-200">← back to dashboard</a>
      </header>

      <section className="grid grid-cols-12 gap-4">
        {/* Setup panel */}
        <div className="col-span-12 lg:col-span-4 bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h2 className="font-semibold text-sm text-purple-300 mb-3">Setup</h2>
          <div className="grid grid-cols-2 gap-3 text-xs">
            {([
              ['Isc STC (A)', 'isc_stc'], ['Impp STC (A)', 'impp_stc'],
              ['Vmpp STC (V)', 'vmpp_stc'], ['Voc STC (V)', 'voc_stc'],
              ['Temp (°C)', 'temperature_c'],
              ['Duration (h)', 'total_duration_h'],
              ['IV interval (h)', 'iv_interval_h'],
              ['Telem (s)', 'telemetry_interval_s'],
              ['Pass thresh (%)', 'max_allowed_loss_pct'],
              ['Drift alarm (%)', 'drift_alarm_pct'],
            ] as const).map(([label, key]) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-gray-400">{label}</span>
                <input
                  data-testid={`field-${key}`}
                  type="number" step="0.01"
                  value={form[key] as number}
                  onChange={e => setForm(f => ({ ...f, [key]: Number(e.target.value) }))}
                  className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
                />
              </label>
            ))}
            <label className="col-span-2 flex items-center gap-2 mt-1">
              <input type="checkbox" checked={form.demo_mode}
                     onChange={e => setForm(f => ({ ...f, demo_mode: e.target.checked }))} />
              <span className="text-gray-400">Demo mode (simulate degradation curve)</span>
            </label>
          </div>

          <div className="mt-4 bg-purple-950/30 border border-purple-800/40 rounded p-3 text-xs text-purple-200">
            Iinj = Impp = <strong>{form.impp_stc.toFixed(3)} A</strong> · Pmpp@STC ≈
            <strong> {(form.vmpp_stc * form.impp_stc).toFixed(1)} W</strong>
          </div>

          <div className="mt-4 flex gap-2">
            <button data-testid="start-btn"
                    onClick={onStart} disabled={running}
                    className="flex-1 bg-purple-700 hover:bg-purple-600 disabled:bg-gray-700 text-white text-xs px-3 py-2 rounded">
              Start
            </button>
            <button data-testid="pause-btn" onClick={onPause} disabled={!running}
                    className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-xs px-3 py-2 rounded">
              Pause
            </button>
            <button data-testid="resume-btn" onClick={onResume} disabled={!running}
                    className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-xs px-3 py-2 rounded">
              Resume
            </button>
            <button data-testid="stop-btn" onClick={onStop} disabled={!sessionId}
                    className="bg-red-700 hover:bg-red-600 disabled:opacity-50 text-xs px-3 py-2 rounded">
              Stop
            </button>
          </div>

          <div className="mt-4 text-xs text-gray-400" data-testid="session-id">
            session: <span className="font-mono text-gray-200">{sessionId ?? '—'}</span>
          </div>
        </div>

        {/* Live metrics + chart */}
        <div className="col-span-12 lg:col-span-8 space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <Stat label="ΔPmax live" value={`${liveLossPct.toFixed(3)} %`}
                  color={liveLossPct > form.max_allowed_loss_pct ? 'text-red-400' : 'text-green-400'}
                  testid="stat-loss" />
            <Stat label="IV points" value={iv.length} color="text-purple-300" testid="stat-iv-count" />
            <Stat label="Dose" value={`${(iv[iv.length - 1]?.dose_sun_h ?? 0).toFixed(2)} sun·h`}
                  color="text-yellow-300" testid="stat-dose" />
            <Stat label="Status"
                  value={summary ? (summary.passed ? 'PASS' : 'FAIL') : (running ? 'RUNNING' : 'IDLE')}
                  color={summary ? (summary.passed ? 'text-green-400' : 'text-red-400') : 'text-blue-300'}
                  testid="stat-status" />
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 h-80">
            <h2 className="font-semibold text-sm text-purple-300 mb-2">Pmax vs elapsed time</h2>
            <ResponsiveContainer width="100%" height="90%">
              <LineChart data={curveData}>
                <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                <XAxis dataKey="elapsed_h" stroke="#9ca3af" type="number"
                       label={{ value: 'elapsed (h)', position: 'insideBottom', offset: -2, fill: '#9ca3af' }} />
                <YAxis stroke="#9ca3af" domain={['auto', 'auto']}
                       label={{ value: 'Pmpp (W)', angle: -90, position: 'insideLeft', fill: '#9ca3af' }} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151' }} />
                <Legend />
                <Line type="monotone" dataKey="pmpp" name="measured" stroke="#a78bfa" dot={{ r: 3 }} />
                {summary?.fit && (
                  <Line type="monotone" dataKey="fit" name="fit" stroke="#fbbf24"
                        strokeDasharray="4 4" dot={false} />
                )}
                {p0 > 0 && (
                  <ReferenceLine y={p0 * (1 - form.max_allowed_loss_pct / 100)} stroke="#ef4444"
                                 strokeDasharray="2 4"
                                 label={{ value: `pass threshold`, position: 'right', fill: '#ef4444', fontSize: 10 }} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {summary && (
            <div data-testid="results-panel"
                 className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-xs space-y-2">
              <h2 className="font-semibold text-sm text-purple-300">Results & fit parameters</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Field label="Verdict"
                       value={summary.passed ? 'PASS' : 'FAIL'}
                       color={summary.passed ? 'text-green-400' : 'text-red-400'} />
                <Field label="Max ΔPmax" value={`${summary.max_relative_loss_pct.toFixed(3)} %`} />
                <Field label="t_min" value={`${summary.time_to_min_h.toFixed(2)} h`} />
                <Field label="Regen frac" value={summary.regeneration_fraction.toFixed(3)} />
                {summary.fit && (
                  <>
                    <Field label="P0 (fit)" value={`${summary.fit.p0.toFixed(2)} W`} />
                    <Field label="A_d" value={summary.fit.amp_degrade.toFixed(4)} />
                    <Field label="τ_d (h)" value={summary.fit.tau_degrade_h.toFixed(2)} />
                    <Field label="A_r" value={summary.fit.amp_regen.toFixed(4)} />
                    <Field label="τ_r (h)" value={summary.fit.tau_regen_h.toFixed(2)} />
                    <Field label="RMSE" value={summary.fit.rmse.toExponential(2)} />
                  </>
                )}
              </div>
              {summary.csv_path && (
                <p className="text-gray-400 pt-2">Raw CSV: <span className="font-mono">{summary.csv_path}</span></p>
              )}
              {summary.report_path && (
                <p className="text-gray-400">Report JSON: <span className="font-mono">{summary.report_path}</span></p>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="mt-4 grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-7 bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h2 className="font-semibold text-sm text-purple-300 mb-2">Event log</h2>
          <div data-testid="event-log"
               className="font-mono text-[11px] text-gray-300 h-40 overflow-auto whitespace-pre">
            {events.join('\n') || '— no events yet —'}
          </div>
        </div>
        <div className="col-span-12 lg:col-span-5 bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h2 className="font-semibold text-sm text-purple-300 mb-2">Clause references</h2>
          <ul className="text-xs text-gray-300 space-y-1 list-disc list-inside" data-testid="clauses">
            {CLAUSE_REFS.map(c => <li key={c.id}>{c.text}</li>)}
          </ul>
        </div>
      </section>
    </div>
  );
}

function Stat(props: { label: string; value: string | number; color: string; testid: string }): React.JSX.Element {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{props.label}</div>
      <div data-testid={props.testid} className={`text-xl font-bold ${props.color}`}>{props.value}</div>
    </div>
  );
}

function Field(props: { label: string; value: string; color?: string }): React.JSX.Element {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{props.label}</div>
      <div className={`text-sm font-mono ${props.color ?? 'text-gray-100'}`}>{props.value}</div>
    </div>
  );
}
