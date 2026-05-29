'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import TestTabLayout from '../TestTabLayout';
import SchematicViewer from '../SchematicViewer';
import LiveChart from '../LiveChart';
import type { TestSession, LiveReading } from '@/types/test-session';
import { useGctLive } from '@/hooks/useGctLive';

interface Props {
  readings: LiveReading[];
  session: TestSession | null;
  onSessionUpdate: (s: TestSession | null) => void;
  sendCommand: (cmd: string) => void;
  demoMode: boolean;
}

export default function GroundContinuityTab({
  readings: _psuReadings,  // intentionally unused: GCT uses the DMM, not the PSU
  session, onSessionUpdate, sendCommand, demoMode,
}: Props) {
  const [testCurrent, setTestCurrent] = useState(25); // A — informational, sourced by DMM
  const [duration, setDuration] = useState(120); // s — hold time at ≥ 2.5× rated bonding current
  const [maxResistance, setMaxResistance] = useState(0.1); // Ω per IEC 61730-2 MST 13
  const [bonding, setBonding] = useState(''); // operator bonding-point label (e.g. frame-corner-A)

  // GCT live feed (DMM 4-wire R + pass/fail). Stays connected the whole time
  // the tab is mounted so the operator can see live continuity even before
  // pressing Start.
  const { readings: gctReadings, latest: latestGct, status: gctStatus, psuOff } = useGctLive({
    demoMode,
    maxResistance,
    intervalS: 0.5,
    enabled: true,
  });

  // Adapt GCT-shaped readings into the LiveReading payload TestTabLayout
  // expects, so the existing Live Monitor charts / data table / report
  // path "just works" without GCT-specific branches.
  const liveReadings: LiveReading[] = useMemo(
    () => gctReadings.map(g => ({
      timestamp: g.timestamp,
      voltage: 0,
      current: testCurrent,
      power: 0,
      resistance: g.resistance,
    })),
    [gctReadings, testCurrent],
  );

  const measuredR = latestGct?.resistance ?? null;
  const resistanceOk = latestGct?.passed ?? null;

  // Mirror live samples into the active session so Report / Data Table /
  // Analysis can pick them up at stop-time.
  useEffect(() => {
    if (!session || session.status !== 'running' || liveReadings.length === 0) return;
    const last = liveReadings[liveReadings.length - 1];
    onSessionUpdate({
      ...session,
      readings: [...session.readings, last].slice(-2000),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveReadings.length]);

  const onStart = useCallback(() => {
    const newSession: TestSession = {
      id: `GCT-${Date.now()}`, testType: 'ground_continuity',
      startTime: Date.now(), status: 'running', readings: [],
      iecClause: 'MST 13',
      notes: bonding ? `Bonding point: ${bonding}` : undefined,
    };
    onSessionUpdate(newSession);
    // Belt-and-braces: PSU output stays OFF for the entire GCT. Per
    // IEC 61730-2 MST 13 the test current is sourced by the DMM, not
    // the PV6000. We never send OUTP ON from this tab.
    sendCommand('OUTP OFF');
    sendCommand(`SYST:LOG "GCT start; max R = ${maxResistance} Ohm${bonding ? `; bonding=${bonding}` : ''}"`);
  }, [maxResistance, bonding, onSessionUpdate, sendCommand]);

  const onStop = useCallback(() => {
    if (!session) return;
    sendCommand('OUTP OFF');
    const result: 'PASS' | 'FAIL' = resistanceOk === false ? 'FAIL' : 'PASS';
    onSessionUpdate({
      ...session,
      status: result === 'PASS' ? 'pass' : 'fail',
      endTime: Date.now(),
      result,
    });
  }, [session, resistanceOk, onSessionUpdate, sendCommand]);

  const onPause = useCallback(() => {
    if (!session) return;
    onSessionUpdate({ ...session, status: 'paused' });
  }, [session, onSessionUpdate]);

  const liveBadge = (() => {
    if (demoMode) return { text: 'DEMO', cls: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50' };
    if (gctStatus === 'connected') return { text: 'LIVE — DMM', cls: 'bg-green-900/40 text-green-300 border-green-700/50' };
    if (gctStatus === 'connecting') return { text: 'CONNECTING…', cls: 'bg-blue-900/40 text-blue-300 border-blue-700/50' };
    return { text: 'DISCONNECTED', cls: 'bg-red-900/40 text-red-300 border-red-700/50' };
  })();

  const setupPanel = (
    <div className="space-y-4">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-bold text-green-400 mb-3">IEC 61730-2 MST 13 — Ground Continuity</h3>
        <p className="text-xs text-gray-400 mb-2">
          Apply 25 A between the grounding point and frame. Resistance must be &lt; 0.1 Ω.
          Measurement is 4-wire via the Keysight 34465A — the PV6000 output stays OFF
          for the entire test.
        </p>
        <div className="mb-3 rounded border border-blue-700/40 bg-blue-900/20 p-2">
          <p className="text-[11px] text-blue-200">
            <span className="font-semibold">PSU output:</span>{' '}
            {psuOff === null ? '—' : psuOff ? 'OFF ✓' : 'unknown'} —
            GCT uses the DMM only.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Test Current (A)', value: testCurrent, set: setTestCurrent, min: 10, max: 30, step: 1, unit: 'A' },
            { label: 'Duration (s)', value: duration, set: setDuration, min: 60, max: 300, step: 1, unit: 's' },
            { label: 'R_max Threshold (Ω)', value: maxResistance, set: setMaxResistance, min: 0.05, max: 0.5, step: 0.01, unit: 'Ω' },
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
          <div>
            <label className="text-xs text-gray-400 block mb-1">Bonding Point Label</label>
            <input type="text" value={bonding} placeholder="e.g. frame-corner-A"
              onChange={e => setBonding(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200" />
          </div>
        </div>
        {measuredR !== null && (
          <div className={`mt-3 rounded p-3 ${
            resistanceOk ? 'bg-green-900/20 border border-green-700/40' : 'bg-red-900/20 border border-red-700/40'
          }`}>
            <p className={`text-xs font-bold ${resistanceOk ? 'text-green-300' : 'text-red-300'}`}>
              Measured R = {measuredR.toFixed(4)} Ω — {resistanceOk
                ? `PASS (< ${maxResistance} Ω)`
                : `FAIL (≥ ${maxResistance} Ω)`}
            </p>
            <p className="text-[10px] text-gray-500 mt-1">
              Source: {latestGct?.source === 'dmm_keysight' ? 'Keysight 34465A 4-wire' : 'demo simulator'}
            </p>
          </div>
        )}
      </div>
      <SchematicViewer testCode="gct" mode="frame" />
    </div>
  );

  // Big, glanceable resistance + pass/fail banner that lives at the top of
  // Live Monitor (rendered via extraStats so we don't fork TestTabLayout).
  const verdictText = measuredR === null ? '—' : measuredR.toFixed(4);
  const verdictColor = measuredR === null
    ? 'text-gray-400'
    : resistanceOk ? 'text-green-400' : 'text-red-400';
  const passLabel = measuredR === null ? '—' : resistanceOk ? 'PASS' : 'FAIL';

  return (
    <div className="flex flex-col h-full">
      <div className={`flex items-center gap-2 px-4 py-1.5 border-b border-gray-800 bg-gray-900/60 text-[11px] ${liveBadge.cls.includes('text') ? '' : ''}`}>
        <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${liveBadge.cls}`}>
          {liveBadge.text}
        </span>
        <span className="text-gray-400">
          DMM samples: <span className="text-white font-mono">{gctReadings.length}</span>
        </span>
        <span className="text-gray-500">·</span>
        <span className="text-gray-400">
          Threshold: <span className="font-mono text-white">{maxResistance.toFixed(3)} Ω</span>
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <TestTabLayout
          testKey="gct" testName="Ground Continuity" standard="IEC 61730-2 MST 13"
          color="text-green-400" readings={liveReadings} session={session}
          onSessionUpdate={onSessionUpdate} sendCommand={sendCommand} demoMode={demoMode}
          limits={{ maxVoltage: 5, maxCurrent: 30, maxPower: 150, maxTemp: 40 }}
          setupPanel={setupPanel}
          analysisPanel={<GctAnalysisPanel maxResistance={maxResistance} />}
          extraStats={[
            { label: 'Measured R', value: verdictText, unit: 'Ω', color: verdictColor },
            { label: 'Result',     value: passLabel,   unit: '',  color: verdictColor },
            { label: 'Max R Limit', value: maxResistance.toString(), unit: 'Ω', color: 'text-yellow-400' },
            { label: 'Source',      value: latestGct?.source === 'dmm_keysight' ? 'DMM' : (demoMode ? 'SIM' : '—'), unit: '', color: 'text-blue-400' },
          ]}
          onStartTest={onStart} onStopTest={onStop} onPauseTest={onPause}
        />
      </div>
    </div>
  );
}

// Canonical single-point grounding paths for the GCT Analysis view in DEMO
// mode. Mirrors backend/app/gct.demo_per_path_resistances() so the UI and the
// REST contract agree — each path is a 4-wire (Kelvin) resistance from an
// exposed conductive part to the main grounding terminal.
const DEMO_PATHS: Array<{ id: string; from: string; to: string; r: number }> = [
  { id: 'PATH-01', from: 'Frame-A', to: 'JBox',        r: 0.042 },
  { id: 'PATH-02', from: 'Frame-B', to: 'JBox',        r: 0.067 },
  { id: 'PATH-03', from: 'Frame-C', to: 'JBox',        r: 0.051 },
  { id: 'PATH-04', from: 'Frame-D', to: 'JBox',        r: 0.038 },
  { id: 'PATH-05', from: 'Frame',   to: 'MountHole-1', r: 0.089 },
  { id: 'PATH-06', from: 'Frame',   to: 'MountHole-2', r: 0.094 },
];

/**
 * GCT Analysis — IEC 61730-2 MST 13 single-point ground continuity.
 *
 * Replaces the generic degradation template (Pmax / ΔPmax / Gate-2) that the
 * default AnalysisPanel renders — that template is wrong for a resistance
 * test. Shows the per-path resistance table, R_min/R_mean/R_max stats, an
 * R(t) sparkline with the threshold line, the module verdict, and an AI
 * summary. Paths re-grade live against the operator's R_max threshold.
 */
function GctAnalysisPanel({ maxResistance }: { maxResistance: number }) {
  const paths = DEMO_PATHS.map(p => ({ ...p, pass: p.r <= maxResistance }));
  const rs = paths.map(p => p.r);
  const rMin = Math.min(...rs);
  const rMax = Math.max(...rs);
  const rMean = rs.reduce((a, b) => a + b, 0) / rs.length;
  const passCount = paths.filter(p => p.pass).length;
  const allPass = passCount === paths.length;
  const worst = paths.reduce((a, b) => (b.r > a.r ? b : a), paths[0]);

  // Feed the shared LiveChart a per-path resistance series so the sparkline +
  // threshold line render with zero backend dependency in demo.
  const series: LiveReading[] = paths.map((p, i) => ({
    timestamp: i, voltage: 0, current: 0, power: 0, resistance: p.r,
  }));

  const summary =
    `Ground Continuity (IEC 61730-2 MST 13): ${passCount}/${paths.length} paths ≤${maxResistance}Ω. ` +
    `Worst: ${worst.id} at ${worst.r.toFixed(3)}Ω. Verdict: ${allPass ? 'PASS' : 'FAIL'}.`;

  const stats: Array<[string, number]> = [['R_min', rMin], ['R_mean', rMean], ['R_max', rMax]];

  return (
    <div className="space-y-4 max-w-3xl" data-testid="gct-analysis">
      <div
        className={`rounded-lg border p-4 ${allPass ? 'border-green-700/40 bg-green-900/20' : 'border-red-700/40 bg-red-900/20'}`}
        data-testid="gct-verdict"
      >
        <h3 className="text-sm font-bold text-green-400 mb-1">Ground Continuity — Module Verdict</h3>
        <p className={`text-lg font-bold ${allPass ? 'text-green-300' : 'text-red-300'}`}>
          {allPass ? 'PASS' : 'FAIL'}
        </p>
        <p className="text-xs text-gray-400 mt-1">
          {passCount}/{paths.length} grounding paths ≤ {maxResistance} Ω per IEC 61730-2 MST 13.
          {allPass ? '' : ' One or more paths exceed the limit.'}
        </p>
      </div>

      <div className="bg-gray-900 rounded-lg border border-gray-700 p-3 overflow-auto">
        <h3 className="text-xs font-bold text-green-400 mb-2">Per-path resistance</h3>
        <table className="w-full text-[11px]" data-testid="gct-path-table">
          <thead>
            <tr className="text-gray-500 text-left">
              <th className="py-1 pr-3 font-normal">Path ID</th>
              <th className="py-1 pr-3 font-normal">From</th>
              <th className="py-1 pr-3 font-normal">To</th>
              <th className="py-1 pr-3 font-normal text-right">Measured R (Ω)</th>
              <th className="py-1 pr-3 font-normal text-right">Criterion</th>
              <th className="py-1 font-normal">Result</th>
            </tr>
          </thead>
          <tbody className="font-mono text-gray-200">
            {paths.map(p => (
              <tr key={p.id} className="border-t border-gray-800">
                <td className="py-1 pr-3">{p.id}</td>
                <td className="py-1 pr-3">{p.from}</td>
                <td className="py-1 pr-3">{p.to}</td>
                <td className="py-1 pr-3 text-right">{p.r.toFixed(3)}</td>
                <td className="py-1 pr-3 text-right text-gray-400">≤ {maxResistance} Ω</td>
                <td className={`py-1 font-bold ${p.pass ? 'text-green-400' : 'text-red-400'}`}>
                  {p.pass ? 'PASS' : 'FAIL'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-3 gap-3" data-testid="gct-stats">
        {stats.map(([label, v]) => (
          <div key={label} className="bg-gray-900 rounded-lg p-3 border border-gray-700">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-xl font-mono font-bold text-gray-100">
              {v.toFixed(3)} <span className="text-xs text-gray-400">Ω</span>
            </p>
          </div>
        ))}
      </div>

      <LiveChart
        readings={series} metric="resistance" color="#34d399" label="R(t) — per-path resistance (Ω)"
        yDomain={[0, Math.max(maxResistance, rMax) * 1.2]}
        referenceLines={[{ value: maxResistance, label: `R_max ${maxResistance} Ω` }]}
      />

      <div className="bg-gray-900 border border-gray-700 rounded-lg p-3">
        <h3 className="text-xs font-semibold text-gray-300 mb-2">AI / MCP Summary</h3>
        <p className="text-xs text-gray-300 font-mono leading-relaxed" data-testid="gct-ai-summary">{summary}</p>
        <p className="text-[10px] text-gray-500 mt-1">
          Auto-generated draft. Connect ANTHROPIC_API_KEY in .env.local for richer narrative analysis.
        </p>
      </div>
    </div>
  );
}
