'use client';

import { useState, useCallback } from 'react';
import TestTabLayout from '../TestTabLayout';
import SchematicViewer from '../SchematicViewer';
import RcoAnalysisPanel from '@/features/rco/analysis/RcoAnalysisPanel';
import type { TestSession, LiveReading } from '@/types/test-session';

import { stampOperatorContext } from '@/lib/operator-store';
interface Props {
  readings: LiveReading[];
  session: TestSession | null;
  onSessionUpdate: (s: TestSession | null) => void;
  sendCommand: (cmd: string) => void;
  demoMode: boolean;
}

export default function ReverseCurrentTab({ readings, session, onSessionUpdate, sendCommand, demoMode }: Props) {
  const [isc, setIsc] = useState(10.0);
  const [fuseRating, setFuseRating] = useState(10.0);
  const [duration, setDuration] = useState(2); // hours
  const [voltageLimit, setVoltageLimit] = useState(1.0); // V drop limit

  // IEC 61730-2:2023 MST 26: test at 135% of max series fuse rating
  const testCurrent = +(fuseRating * 1.35).toFixed(3);
  const latest = readings[readings.length - 1];
  const currentOk = latest ? latest.current <= testCurrent * 1.05 : true;

  const onStart = useCallback(() => {
    const draft: TestSession = {
      id: `RCO-${Date.now()}`, testType: 'reverse_current',
      startTime: Date.now(), status: 'running', readings: [],
    };

    // Stamp operator/customer/equipment context (#128) so reports stop saying "NA".

    const newSession: TestSession = stampOperatorContext(draft);
    onSessionUpdate(newSession);
    sendCommand('SOUR:FUNC:MODE CC');
    sendCommand(`SOUR:CURR ${testCurrent}`);
    sendCommand(`SOUR:VOLT:LIM ${voltageLimit}`);
    sendCommand('OUTP ON');
    sendCommand(`PROG:RCO:TIME ${duration * 3600}`);
    sendCommand('PROG:EXEC');
  }, [testCurrent, voltageLimit, duration, onSessionUpdate, sendCommand]);

  const onStop = useCallback(() => {
    if (!session) return;
    sendCommand('OUTP OFF');
    onSessionUpdate({ ...session, status: 'pass', endTime: Date.now(), result: 'PASS' });
  }, [session, onSessionUpdate, sendCommand]);

  const onPause = useCallback(() => {
    if (!session) return;
    onSessionUpdate({ ...session, status: 'paused' });
  }, [session, onSessionUpdate, sendCommand]);

  const setupPanel = (
    <div className="space-y-4">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-bold text-red-400 mb-3">IEC 61730-2:2023 MST 26 — Reverse Current Overload</h3>
        <p className="text-xs text-gray-400 mb-4">
          Apply 135% of max series fuse current rating in reverse direction.
          Monitor for fire, melting, or module failure.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Isc (A)', value: isc, set: setIsc, min: 0.1, max: 50, step: 0.1, unit: 'A' },
            { label: 'Max Fuse Rating (A)', value: fuseRating, set: setFuseRating, min: 1, max: 50, step: 0.5, unit: 'A' },
            { label: 'Duration (hr)', value: duration, set: setDuration, min: 0.5, max: 10, step: 0.5, unit: 'hr' },
            { label: 'Voltage Limit (V)', value: voltageLimit, set: setVoltageLimit, min: 0.1, max: 5, step: 0.1, unit: 'V' },
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
        <div className="mt-3 bg-red-900/20 border border-red-700/40 rounded p-3">
          <p className="text-xs text-red-300">
            ● Test current = {fuseRating} × 1.35 = <strong>{testCurrent} A</strong> (reverse)
          </p>
          <p className="text-xs text-red-300 mt-1">
            ⚠️ FAIL if fire, melting, or delamination observed
          </p>
        </div>
      </div>
      <SchematicViewer testCode="rco" />
    </div>
  );

  // IEC-aware Analysis pane — derives envelope/V-drop/T/soak verdicts
  // from live readings, same template as TC (#114) and HF (#125).
  const analysisPanel = (
    <RcoAnalysisPanel
      readings={readings}
      config={{ fuseRating, voltageLimit, durationHours: duration }}
    />
  );

  return (
    <TestTabLayout
      testKey="rco" testName="Reverse Current Overload" standard="IEC 61730-2:2023 MST 26"
      color="text-red-400" readings={readings} session={session}
      onSessionUpdate={onSessionUpdate} sendCommand={sendCommand} demoMode={demoMode}
      limits={{ maxVoltage: 10, maxCurrent: testCurrent * 1.1, maxPower: 100, maxTemp: 60 }}
      setupPanel={setupPanel}
      analysisPanel={analysisPanel}
      extraStats={[
        { label: 'Fuse Rating', value: fuseRating.toString(), unit: 'A', color: 'text-gray-400' },
        { label: 'Test Current (135%)', value: testCurrent.toString(), unit: 'A', color: 'text-red-400' },
        { label: 'Duration', value: duration.toString(), unit: 'hr', color: 'text-yellow-400' },
        { label: 'V Limit', value: voltageLimit.toString(), unit: 'V', color: 'text-blue-400' },
      ]}
      onStartTest={onStart} onStopTest={onStop} onPauseTest={onPause}
    />
  );
}
