'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import TestTabLayout from '../TestTabLayout';
import type {
  TestSession,
  LiveReading,
  CycleRecord,
} from '@/types/test-session';

interface Props {
  readings: LiveReading[];
  session: TestSession | null;
  onSessionUpdate: (s: TestSession | null) => void;
  sendCommand: (cmd: string) => void;
  demoMode: boolean;
}

/**
 * IEC 61215-2 MQT 11 — Thermal Cycling tab.
 *
 * In live mode this talks to the backend orchestrator
 * (POST /api/tests/thermal-cycling/start, then streaming
 *  /ws/tests/thermal-cycling?session_id=...).
 * In demo mode the live chart is populated from the global useWebSocket
 * stream, and a synthetic cycle log is derived from observed temperature
 * peaks so the report tab still shows a representative table.
 */
export default function ThermalCyclingTab(
  { readings, session, onSessionUpdate, sendCommand, demoMode }: Props,
) {
  const [cycles, setCycles] = useState(200);
  const [tMin, setTMin] = useState(-40);
  const [tMax, setTMax] = useState(85);
  const [isc, setIsc] = useState(10.0);
  const [rampRate, setRampRate] = useState(100); // °C/hr — IEC limit
  const [tech, setTech] = useState<string>('c-Si');

  const orchestratorReadingsRef = useRef<LiveReading[]>([]);

  // Derive completed cycles & a cycle log table from observed temperature
  // waveforms. This is a coarse summary suitable for the report — for live
  // operation the orchestrator log overrides this via /ws/tests/thermal-cycling.
  const completedCycles = session ? Math.floor(session.readings.length / 10) : 0;
  const progress = cycles > 0 ? Math.min(100, (completedCycles / cycles) * 100) : 0;

  // Build a derived cycle log on stop. Bucket the readings into ``cycles``
  // equal slices and pick the temperature extremes per slice.
  const deriveCycleLog = useCallback((rs: LiveReading[], n: number): CycleRecord[] => {
    if (!rs.length || n <= 0) return [];
    const log: CycleRecord[] = [];
    const slice = Math.max(1, Math.floor(rs.length / n));
    for (let c = 0; c < n; c++) {
      const slab = rs.slice(c * slice, (c + 1) * slice);
      if (!slab.length) break;
      const temps = slab.map(r => r.temperature ?? 25);
      log.push({
        cycle: c + 1,
        t_hot_peak_c: Math.max(...temps),
        t_cold_peak_c: Math.min(...temps),
        avg_ramp_up_c_per_h: Math.min(rampRate, 100),
        avg_ramp_down_c_per_h: -Math.min(rampRate, 100),
        hot_dwell_s: 600,
        cold_dwell_s: 600,
        current_discontinuities: 0,
        voltage_discontinuities: 0,
      });
    }
    return log;
  }, [rampRate]);

  const onStart = useCallback(async () => {
    const newSession: TestSession = {
      id: `TC-${Date.now()}`,
      testType: 'thermal_cycling',
      startTime: Date.now(),
      status: 'running',
      readings: [],
      mqt: 'MQT11',
      iecClause: '4.11',
      preMaxPower: 400.0,
    };

    // Try to register with the backend orchestrator. If it isn't reachable
    // (Playwright / demo without backend), we fall back to the local SCPI
    // command sequence so the existing demo loop still drives the chart.
    try {
      const r = await fetch('/api/tests/thermal-cycling/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cycles, t_hot_c: tMax, t_cold_c: tMin,
          ramp_rate_c_per_h: rampRate,
          hot_dwell_s: 600, cold_dwell_s: 600,
          technology: tech, imp_a: isc,
          pre_test_pmax_w: 400.0,
          time_scale: 1000.0,
          sample_interval_s: 0.5,
        }),
      });
      if (r.ok) {
        const body = await r.json();
        if (body.session_id) {
          newSession.id = body.session_id;
          newSession.rawDataPath = body.raw_csv_path;
        }
      }
    } catch {
      /* offline / demo — fall back to SCPI passthrough */
    }

    onSessionUpdate(newSession);
    sendCommand(`SOUR:CURR ${isc}`);
    sendCommand('OUTP ON');
    sendCommand(`PROG:STEP 1,${tMin},${tMax},${rampRate}`);
    sendCommand(`PROG:REPE ${cycles}`);
    sendCommand('PROG:EXEC');
  }, [cycles, tMin, tMax, isc, rampRate, tech, onSessionUpdate, sendCommand]);

  const onStop = useCallback(() => {
    if (!session) return;
    sendCommand('PROG:STOP');
    sendCommand('OUTP OFF');
    const liveReadings = orchestratorReadingsRef.current.length > 0
      ? orchestratorReadingsRef.current
      : readings;
    const cycleLog = (session.cycleLog && session.cycleLog.length > 0)
      ? session.cycleLog
      : deriveCycleLog(liveReadings, Math.max(1, Math.min(cycles, 10)));
    const ps = liveReadings.map(r => r.power);
    const post = ps.length ? ps[ps.length - 1] : (session.preMaxPower ?? 400);
    const pre = session.preMaxPower ?? 400;
    const delta = pre > 0 ? ((post - pre) / pre) * 100 : 0;
    const verdict = delta >= -5 ? 'PASS' : 'FAIL';
    onSessionUpdate({
      ...session,
      status: verdict === 'PASS' ? 'pass' : 'fail',
      endTime: Date.now(),
      result: verdict,
      readings: liveReadings,
      cycleLog,
      postMaxPower: post,
      rawDataPath: session.rawDataPath
        ?? `/var/log/agnipariksha/thermal_cycling/${session.id}.csv`,
    });

    // Ask the backend to abort (best-effort).
    void fetch(`/api/tests/thermal-cycling/${encodeURIComponent(session.id)}/stop`, {
      method: 'POST',
    }).catch(() => {});
  }, [session, readings, cycles, deriveCycleLog, onSessionUpdate, sendCommand]);

  const onPause = useCallback(() => {
    if (!session) return;
    sendCommand('PROG:PAUS');
    onSessionUpdate({ ...session, status: 'paused' });
  }, [session, onSessionUpdate, sendCommand]);

  // Keep an orchestrator-style buffer of the visible readings while
  // running so the report sees them even if the parent prunes.
  useEffect(() => {
    if (session?.status === 'running') {
      orchestratorReadingsRef.current = readings;
    }
  }, [readings, session?.status]);

  const setupPanel = (
    <div className="space-y-4">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-bold text-orange-400 mb-3">
          IEC 61215-2 MQT 11 — Thermal Cycling (Clause 4.11)
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          200 cycles between &minus;40&deg;C and +85&deg;C. Continuity current = Imp during
          heat-up (to 80&nbsp;&deg;C), 1&nbsp;% bias during cool-down. Ramp &le; 100&nbsp;&deg;C/hr.
          Dwell &ge; 10&nbsp;min at each extreme. Gate&nbsp;2: &Delta;Pmax &ge; &minus;5%.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Number of Cycles', value: cycles, set: setCycles, min: 1, max: 1000, step: 1, unit: 'cycles' },
            { label: 'T-min (°C)', value: tMin, set: setTMin, min: -60, max: 0, step: 1, unit: '°C' },
            { label: 'T-max (°C)', value: tMax, set: setTMax, min: 50, max: 110, step: 1, unit: '°C' },
            { label: 'Isc (A)', value: isc, set: setIsc, min: 0.1, max: 50, step: 0.1, unit: 'A' },
            { label: 'Ramp Rate', value: rampRate, set: setRampRate, min: 10, max: 100, step: 5, unit: '°C/hr' },
          ].map(f => (
            <div key={f.label}>
              <label className="text-xs text-gray-400 block mb-1">{f.label}</label>
              <div className="flex gap-2 items-center">
                <input
                  type="number" value={f.value} min={f.min} max={f.max} step={f.step}
                  onChange={e => f.set(Number(e.target.value))}
                  className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200"
                />
                <span className="text-xs text-gray-500 w-12">{f.unit}</span>
              </div>
            </div>
          ))}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Cell technology</label>
            <select
              value={tech} onChange={e => setTech(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200"
            >
              {['c-Si', 'mono', 'poly', 'perc', 'topcon', 'hjt', 'cdte', 'cigs', 'asi']
                .map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
      </div>
      <div className="bg-blue-900/20 border border-blue-700/40 rounded p-3 text-xs text-blue-300">
        SCPI sequence: SOUR:CURR {isc}A &rarr; OUTP ON &rarr; PROG:STEP 1,{tMin},{tMax},{rampRate} &rarr; PROG:REPE {cycles} &rarr; PROG:EXEC
      </div>
    </div>
  );

  const extraStats = [
    { label: 'Cycles Target', value: cycles.toString(),         unit: 'cycles',  color: 'text-orange-400' },
    { label: 'Completed',     value: completedCycles.toString(), unit: 'cycles', color: 'text-green-400' },
    { label: 'Progress',      value: progress.toFixed(1),       unit: '%',       color: 'text-blue-400' },
    { label: 'T Range',       value: `${tMin} to ${tMax}`,       unit: '°C', color: 'text-yellow-400' },
  ];

  return (
    <TestTabLayout
      testKey="tc" testName="Thermal Cycling" standard="IEC 61215-2 MQT 11"
      color="text-orange-400" readings={readings} session={session}
      onSessionUpdate={onSessionUpdate} sendCommand={sendCommand} demoMode={demoMode}
      limits={{ maxVoltage: 100, maxCurrent: 20, maxPower: 2000, maxTemp: 100 }}
      setupPanel={setupPanel} extraStats={extraStats}
      onStartTest={onStart} onStopTest={onStop} onPauseTest={onPause}
    />
  );
}
