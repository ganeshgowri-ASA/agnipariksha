'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import TestTabLayout from '../TestTabLayout';
import type { TestSession, LiveReading } from '@/types/test-session';
import HumidityFreezeProfileChart, { type HFProfilePoint } from './HumidityFreezeProfileChart';

interface Props {
  readings: LiveReading[];
  session: TestSession | null;
  onSessionUpdate: (s: TestSession | null) => void;
  sendCommand: (cmd: string) => void;
  demoMode: boolean;
}

interface HFRunPayload {
  cycles: number;
  t_hot_c: number;
  t_cold_c: number;
  rh_hot_percent: number;
  hot_dwell_hours: number;
  cold_dwell_minutes: number;
  i_mp_stc_a: number;
  v_oc_stc_v: number;
  time_compression: number;
}

interface HFRamp {
  cycle: number;
  phase: string;
  rate_c_per_h: number;
  limit_c_per_h: number;
}

interface HFDwell {
  cycle: number;
  phase: string;
  duration_s: number;
  minimum_s: number;
  in_tolerance: boolean;
  ok: boolean;
}

interface HFRunResult {
  session_id: string;
  verdict: 'PASS' | 'FAIL' | 'ABORTED' | 'IN_PROGRESS';
  reasons: string[];
  iec_clause: string;
  raw_csv_path: string | null;
  cycle_log: Array<Record<string, number | boolean>>;
  ramp_violations: HFRamp[];
  dwell_checks: HFDwell[];
  mqt01_visual_pass: boolean | null;
  mqt15_wet_leakage_pass: boolean | null;
}

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';

export default function HumidityFreezeTab({
  readings, session, onSessionUpdate, sendCommand, demoMode,
}: Props) {
  const [cycles, setCycles] = useState(10);
  const [tHigh, setTHigh] = useState(85);
  const [rhHigh, setRhHigh] = useState(85);
  const [tLow, setTLow] = useState(-40);
  const [dwellHours, setDwellHours] = useState(20);
  const [coldDwellMin, setColdDwellMin] = useState(30);
  const [iMpStc, setIMpStc] = useState(9.0);
  const [compression, setCompression] = useState(600);
  const [profile, setProfile] = useState<HFProfilePoint[]>([]);
  const [result, setResult] = useState<HFRunResult | null>(null);
  const [busy, setBusy] = useState<'profile' | 'run' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const payload: HFRunPayload = useMemo(() => ({
    cycles, t_hot_c: tHigh, t_cold_c: tLow,
    rh_hot_percent: rhHigh,
    hot_dwell_hours: dwellHours,
    cold_dwell_minutes: coldDwellMin,
    i_mp_stc_a: iMpStc, v_oc_stc_v: 45.0,
    time_compression: compression,
  }), [cycles, tHigh, tLow, rhHigh, dwellHours, coldDwellMin, iMpStc, compression]);

  const fetchProfile = useCallback(async () => {
    setError(null);
    setBusy('profile');
    try {
      const r = await fetch(`${BACKEND}/api/tests/humidity-freeze/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(`profile HTTP ${r.status}`);
      const body = await r.json() as { profile: HFProfilePoint[] };
      setProfile(body.profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [payload]);

  const onStart = useCallback(async () => {
    const newSession: TestSession = {
      id: `HF-${Date.now()}`, testType: 'humidity_freeze',
      startTime: Date.now(), status: 'running', readings: [],
      iecClause: 'IEC 61215-2 MQT 12 (Fig 9)',
    };
    onSessionUpdate(newSession);
    sendCommand('SOUR:FUNC:MODE CC');
    sendCommand(`SOUR:CURR ${Math.max(0.1, 0.005 * iMpStc).toFixed(4)}`);
    sendCommand('OUTP ON');
    await fetchProfile();
    setError(null);
    setBusy('run');
    try {
      const r = await fetch(`${BACKEND}/api/tests/humidity-freeze/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(`run HTTP ${r.status}`);
      const body = await r.json() as HFRunResult;
      setResult(body);
      onSessionUpdate({
        ...newSession,
        endTime: Date.now(),
        status: body.verdict === 'PASS' ? 'pass' : 'fail',
        result: body.verdict === 'PASS' ? 'PASS' : 'FAIL',
        rawDataPath: body.raw_csv_path ?? undefined,
        iecClause: body.iec_clause,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      onSessionUpdate({ ...newSession, status: 'aborted' });
    } finally {
      setBusy(null);
    }
  }, [fetchProfile, iMpStc, onSessionUpdate, payload, sendCommand]);

  const onStop = useCallback(() => {
    if (!session) return;
    sendCommand('OUTP OFF');
    onSessionUpdate({
      ...session, status: 'aborted', endTime: Date.now(),
    });
  }, [session, onSessionUpdate, sendCommand]);

  const onPause = useCallback(() => {
    if (!session) return;
    onSessionUpdate({ ...session, status: 'paused' });
  }, [session, onSessionUpdate]);

  useEffect(() => {
    // Pre-fetch profile so the chart renders before the operator clicks Start.
    void fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const biasMa = Math.max(100, 5 * iMpStc).toFixed(0);

  const setupPanel = (
    <div className="space-y-4">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-bold text-blue-400 mb-3">
          IEC 61215-2 MQT 12 — Humidity Freeze (Figure 9)
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          10 cycles of {tHigh}°C / {rhHigh}%RH dwell ({dwellHours} h) →
          ramp down ≤ 200 °C/h → {tLow}°C dwell ({coldDwellMin} min) →
          ramp up ≤ 100 °C/h. Continuous reverse-bias current ≈ {biasMa} mA
          (0.5 % of I<sub>mp,STC</sub>, min 100 mA).
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Cycles',           value: cycles,       set: setCycles,       min: 1,   max: 50,  step: 1,   unit: '' },
            { label: 'High Temp (°C)',   value: tHigh,        set: setTHigh,        min: 40,  max: 100, step: 1,   unit: '°C' },
            { label: 'RH (%)',           value: rhHigh,       set: setRhHigh,       min: 60,  max: 100, step: 1,   unit: '%RH' },
            { label: 'Low Temp (°C)',    value: tLow,         set: setTLow,         min: -60, max: 0,   step: 1,   unit: '°C' },
            { label: 'Hot dwell (h)',    value: dwellHours,   set: setDwellHours,   min: 1,   max: 30,  step: 1,   unit: 'h' },
            { label: 'Cold dwell (min)', value: coldDwellMin, set: setColdDwellMin, min: 10,  max: 240, step: 5,   unit: 'min' },
            { label: 'I_mp STC (A)',     value: iMpStc,       set: setIMpStc,       min: 0.5, max: 30,  step: 0.1, unit: 'A' },
            { label: 'Demo compression', value: compression,  set: setCompression,  min: 1,   max: 10000, step: 50, unit: '×' },
          ].map(f => (
            <div key={f.label}>
              <label className="text-xs text-gray-400 block mb-1">{f.label}</label>
              <div className="flex gap-2 items-center">
                <input type="number" value={f.value} min={f.min} max={f.max} step={f.step}
                  onChange={e => f.set(Number(e.target.value))}
                  className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200" />
                <span className="text-xs text-gray-500 w-12">{f.unit}</span>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button" onClick={fetchProfile} disabled={busy !== null}
          className="mt-3 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs rounded"
        >
          {busy === 'profile' ? 'Loading…' : 'Refresh profile'}
        </button>
      </div>

      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-bold text-gray-200 mb-3">Figure 9 envelope</h3>
        <HumidityFreezeProfileChart profile={profile} />
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 text-xs rounded p-3">
          {error}
        </div>
      )}

      {result && (
        <div className="bg-gray-900 rounded-lg border border-gray-700 p-4 space-y-3"
             data-testid="hf-run-result">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-gray-200">Pass / fail</span>
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${
              result.verdict === 'PASS'   ? 'bg-green-900/60 text-green-300' :
              result.verdict === 'FAIL'   ? 'bg-red-900/60 text-red-300'     :
                                            'bg-gray-700 text-gray-300'
            }`} data-testid="hf-verdict">{result.verdict}</span>
            <span className="text-xs text-gray-500">{result.iec_clause}</span>
          </div>
          {result.reasons.length > 0 && (
            <ul className="list-disc pl-4 text-xs text-red-300 space-y-0.5">
              {result.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
          <div className="text-xs text-gray-400">
            MQT 01 visual: {result.mqt01_visual_pass ? '✓ pass' : '—'} ·
            {' '}MQT 15 wet leakage: {result.mqt15_wet_leakage_pass ? '✓ pass' : '—'} ·
            {' '}Raw CSV: <code className="text-gray-300">{result.raw_csv_path ?? 'n/a'}</code>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-gray-300">
              <thead className="text-gray-400 border-b border-gray-700">
                <tr>
                  <th className="text-left py-1">Cycle</th>
                  <th className="text-right py-1">Hot dwell (s)</th>
                  <th className="text-right py-1">Cold dwell (s)</th>
                  <th className="text-right py-1">Ramp ↓ (°C/h)</th>
                  <th className="text-right py-1">Ramp ↑ (°C/h)</th>
                  <th className="text-center py-1">In tol</th>
                </tr>
              </thead>
              <tbody>
                {result.cycle_log.map(row => (
                  <tr key={`c-${row.cycle as number}`} className="border-b border-gray-800">
                    <td className="py-1">{row.cycle as number}</td>
                    <td className="text-right">{(row.hot_dwell_s as number)?.toFixed?.(0) ?? '—'}</td>
                    <td className="text-right">{(row.cold_dwell_s as number)?.toFixed?.(0) ?? '—'}</td>
                    <td className="text-right">{(row.ramp_down_rate_c_per_h as number)?.toFixed?.(1) ?? '—'}</td>
                    <td className="text-right">{(row.ramp_up_rate_c_per_h as number)?.toFixed?.(1) ?? '—'}</td>
                    <td className="text-center">
                      {row.hot_in_tol && row.cold_in_tol ? '✓' : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <TestTabLayout
      testKey="hf" testName="Humidity Freeze" standard="IEC 61215-2 MQT 12"
      color="text-blue-400" readings={readings} session={session}
      onSessionUpdate={onSessionUpdate} sendCommand={sendCommand} demoMode={demoMode}
      limits={{ maxVoltage: 100, maxCurrent: 20, maxPower: 2000, maxTemp: 100 }}
      setupPanel={setupPanel}
      extraStats={[
        { label: 'Cycles', value: cycles.toString(), unit: '', color: 'text-blue-400' },
        { label: 'Target RH', value: rhHigh.toString(), unit: '%', color: 'text-cyan-400' },
        { label: 'T Range', value: `${tLow} to ${tHigh}`, unit: '°C', color: 'text-yellow-400' },
        { label: 'Bias', value: biasMa, unit: 'mA', color: 'text-green-400' },
      ]}
      onStartTest={() => { void onStart(); }}
      onStopTest={onStop}
      onPauseTest={onPause}
    />
  );
}
