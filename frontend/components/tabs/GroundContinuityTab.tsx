'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import TestTabLayout from '../TestTabLayout';
import ModuleIdField from '../ModuleIdField';
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
  const [duration, setDuration] = useState(2);
  const [maxResistance, setMaxResistance] = useState(0.1); // Ω per IEC 61730-2 MST 13
  const [numPoints, setNumPoints] = useState(5);

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
    };
    onSessionUpdate(newSession);
    // Belt-and-braces: PSU output stays OFF for the entire GCT. Per
    // IEC 61730-2 MST 13 the test current is sourced by the DMM, not
    // the PV6000. We never send OUTP ON from this tab.
    sendCommand('OUTP OFF');
    sendCommand(`SYST:LOG "GCT start; max R = ${maxResistance} Ohm; points=${numPoints}"`);
  }, [maxResistance, numPoints, onSessionUpdate, sendCommand]);

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
      <ModuleIdField accentColor="text-green-400" />
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
            { label: 'Duration (min)', value: duration, set: setDuration, min: 1, max: 10, step: 0.5, unit: 'min' },
            { label: 'Max R (Ω)', value: maxResistance, set: setMaxResistance, min: 0.01, max: 1.0, step: 0.01, unit: 'Ω' },
            { label: 'Test Points', value: numPoints, set: setNumPoints, min: 1, max: 20, step: 1, unit: '' },
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
          setupPanel={setupPanel} extraStats={[
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
