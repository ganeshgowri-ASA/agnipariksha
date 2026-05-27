'use client';

import { useCallback, useState } from 'react';
import TestTabLayout from '../TestTabLayout';
import LiveChart from '../LiveChart';
import type { TestSession, LiveReading } from '@/types/test-session';

interface Props {
  readings: LiveReading[];
  session: TestSession | null;
  onSessionUpdate: (s: TestSession | null) => void;
  sendCommand: (cmd: string) => void;
  demoMode: boolean;
}

// Box–Muller normal, clamped >= 0 — mirrors backend gc.synth_series: R(t) ~ N(0.05, 0.005) Ω.
function gauss(m: number, s: number): number {
  return Math.max(0, m + s * Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random()));
}

export default function GcGroundContinuityTab({
  readings: _psu, // unused: GC sources current via the DMM, not the PSU
  session, onSessionUpdate, sendCommand, demoMode,
}: Props) {
  const [current, setCurrent] = useState(25);   // A — >= 2.5x rated protective bonding current
  const [duration, setDuration] = useState(120); // s
  const [rMax, setRMax] = useState(0.1);         // Ω threshold (IEC 61730-2 MST 13)
  const [bonding, setBonding] = useState('');

  const onStart = useCallback(() => {
    const t0 = Date.now();
    const n = Math.max(1, Math.floor(duration));
    // DEMO: one synthesized 4-wire resistance sample per second for the full duration.
    const readings: LiveReading[] = Array.from({ length: n }, (_, i) => ({
      timestamp: t0 + i * 1000, voltage: 0, current, power: 0, resistance: gauss(0.05, 0.005),
    }));
    onSessionUpdate({
      id: `GC-${t0}`, testType: 'gc_ground_continuity', startTime: t0,
      status: 'running', readings, iecClause: 'MST 13',
      notes: bonding ? `Bonding point: ${bonding}` : undefined,
    });
    sendCommand('OUTP OFF'); // GC never enables the PSU output
  }, [duration, current, bonding, onSessionUpdate, sendCommand]);

  const onStop = useCallback(() => {
    if (!session) return;
    sendCommand('OUTP OFF');
    const rs = session.readings.map(r => r.resistance ?? 0);
    const pass = rs.length > 0 && Math.max(...rs) <= rMax;
    onSessionUpdate({ ...session, status: pass ? 'pass' : 'fail', endTime: Date.now(), result: pass ? 'PASS' : 'FAIL' });
  }, [session, rMax, onSessionUpdate, sendCommand]);

  const onPause = useCallback(() => { if (session) onSessionUpdate({ ...session, status: 'paused' }); }, [session, onSessionUpdate]);

  const numFields: Array<[string, number, (v: number) => void, number, number, number]> = [
    ['Test Current (A)', current, setCurrent, 10, 30, 0.5],
    ['Duration (s)', duration, setDuration, 60, 300, 1],
    ['R_max Threshold (Ω)', rMax, setRMax, 0.05, 0.5, 0.01],
  ];

  const setupPanel = (
    <div className="bg-gray-900 rounded-lg border border-gray-700 p-4 mt-4">
      <h3 className="text-sm font-bold text-teal-400 mb-1">IEC 61730-2 MST 13 — Ground Continuity</h3>
      <p className="text-xs text-gray-400 mb-3">
        Apply ≥ 2.5× the rated protective-bonding current between the bonding point and accessible
        frame; path resistance must stay ≤ {rMax} Ω for the full duration. 4-wire (Keysight 34465A); PV6000 output stays OFF.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {numFields.map(([label, value, set, min, max, step]) => (
          <div key={label}>
            <label className="text-xs text-gray-400 block mb-1">{label}</label>
            <input type="number" value={value} min={min} max={max} step={step}
              onChange={e => set(Number(e.target.value))}
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200" />
          </div>
        ))}
        <div>
          <label className="text-xs text-gray-400 block mb-1">Bonding Point Label</label>
          <input type="text" value={bonding} placeholder="e.g. frame-corner-A"
            onChange={e => setBonding(e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200" />
        </div>
      </div>
    </div>
  );

  return (
    <TestTabLayout
      testKey="gc" testName="GC Ground Continuity" standard="IEC 61730-2 MST 13"
      color="text-teal-400" readings={session?.readings ?? []} session={session}
      onSessionUpdate={onSessionUpdate} sendCommand={sendCommand} demoMode={demoMode}
      limits={{ maxVoltage: 5, maxCurrent: 30, maxPower: 150, maxTemp: 40 }}
      setupPanel={setupPanel}
      analysisPanel={<GcAnalysisPanel session={session} rMax={rMax} />}
      onStartTest={onStart} onStopTest={onStop} onPauseTest={onPause}
    />
  );
}

function GcAnalysisPanel({ session, rMax }: { session: TestSession | null; rMax: number }) {
  const readings = session?.readings ?? [];
  const rs = readings.map(r => r.resistance ?? 0);
  if (rs.length === 0) {
    return (
      <div className="text-xs text-gray-500 text-center py-12" data-testid="gc-analysis-empty">
        No session yet — start a test to see analysis.
      </div>
    );
  }
  const max = Math.max(...rs);
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
  const pass = max <= rMax;
  const stats: Array<[string, number]> = [['R min', Math.min(...rs)], ['R mean', mean], ['R max', max]];

  return (
    <div className="space-y-4" data-testid="gc-analysis">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-teal-400">Ground Continuity — R vs t</h3>
          <p className="text-[11px] text-gray-500">IEC 61730-2 MST 13 · PASS iff R_max ≤ {rMax} Ω across the run</p>
        </div>
        <span data-testid="gc-verdict-pill" className={`px-2 py-0.5 rounded border text-[10px] font-bold ${
          pass ? 'bg-green-900/40 text-green-300 border-green-700/50' : 'bg-red-900/40 text-red-300 border-red-700/50'}`}>
          {pass ? 'PASS' : 'FAIL'}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3" data-testid="gc-stats">
        {stats.map(([label, v]) => (
          <div key={label} className="bg-gray-900 rounded-lg p-3 border border-gray-700">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-xl font-mono font-bold text-gray-100">{v.toFixed(4)} <span className="text-xs text-gray-400">Ω</span></p>
          </div>
        ))}
      </div>
      <LiveChart readings={readings} metric="resistance" color="#2dd4bf" label="Resistance R(t) (Ω)"
        yDomain={[0, Math.max(rMax, max) * 1.15]} referenceLines={[{ value: rMax, label: `R_max ${rMax} Ω` }]} />
    </div>
  );
}
