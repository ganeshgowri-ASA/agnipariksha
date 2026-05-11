'use client';

import { useState, useCallback } from 'react';
import TestTabLayout from '../TestTabLayout';
import type { TestSession, LiveReading } from '@/types/test-session';

interface Props {
  readings: LiveReading[];
  session: TestSession | null;
  onSessionUpdate: (s: TestSession | null) => void;
  sendCommand: (cmd: string) => void;
  demoMode: boolean;
}

export default function GroundContinuityTab({ readings, session, onSessionUpdate, sendCommand, demoMode }: Props) {
  const [testCurrent, setTestCurrent] = useState(25); // A per IEC 61730-2 MST 13
  const [duration, setDuration] = useState(2); // minutes
  const [maxResistance, setMaxResistance] = useState(0.1); // Ω max per standard
  const [numPoints, setNumPoints] = useState(5);

  const latest = readings[readings.length - 1];
  // Calculate resistance = V/I
  const measuredR = latest && latest.current > 0 ? (latest.voltage / latest.current) : null;
  const resistanceOk = measuredR !== null ? measuredR <= maxResistance : null;

  const onStart = useCallback(() => {
    const newSession: TestSession = {
      id: `GCT-${Date.now()}`, testType: 'ground_continuity',
      startTime: Date.now(), status: 'running', readings: [],
    };
    onSessionUpdate(newSession);
    sendCommand('SOUR:FUNC:MODE CC');
    sendCommand(`SOUR:CURR ${testCurrent}`);
    sendCommand(`SOUR:VOLT:LIM 2`);
    sendCommand('OUTP ON');
    sendCommand(`PROG:GCT:POINTS ${numPoints},${testCurrent},${duration * 60}`);
    sendCommand('PROG:EXEC');
  }, [testCurrent, duration, numPoints, onSessionUpdate, sendCommand]);

  const onStop = useCallback(() => {
    if (!session) return;
    sendCommand('OUTP OFF');
    const result = resistanceOk !== false ? 'PASS' : 'FAIL';
    onSessionUpdate({ ...session, status: result === 'PASS' ? 'pass' : 'fail', endTime: Date.now(), result });
  }, [session, resistanceOk, onSessionUpdate, sendCommand]);

  const onPause = useCallback(() => {
    if (!session) return;
    onSessionUpdate({ ...session, status: 'paused' });
  }, [session, onSessionUpdate, sendCommand]);

  const setupPanel = (
    <div className="space-y-4">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-bold text-green-400 mb-3">IEC 61730-2 MST 13 — Ground Continuity</h3>
        <p className="text-xs text-gray-400 mb-4">
          Apply 25A between grounding point and frame. Resistance must be ≤ 0.1Ω.
          Duration ≥ 2 minutes per measurement point.
        </p>
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
              Measured R = {measuredR.toFixed(4)} Ω — {resistanceOk ? '✅ PASS (< ' + maxResistance + 'Ω)' : '❌ FAIL (> ' + maxResistance + 'Ω)'}
            </p>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <TestTabLayout
      testKey="gct" testName="Ground Continuity" standard="IEC 61730-2 MST 13"
      color="text-green-400" readings={readings} session={session}
      onSessionUpdate={onSessionUpdate} sendCommand={sendCommand} demoMode={demoMode}
      limits={{ maxVoltage: 5, maxCurrent: 30, maxPower: 150, maxTemp: 40 }}
      setupPanel={setupPanel} extraStats={[
        { label: 'Test Current', value: testCurrent.toString(), unit: 'A', color: 'text-green-400' },
        { label: 'Max R Limit', value: maxResistance.toString(), unit: 'Ω', color: 'text-yellow-400' },
        { label: 'Measured R', value: measuredR?.toFixed(4) || '—', unit: 'Ω', color: resistanceOk === false ? 'text-red-400' : 'text-green-400' },
        { label: 'Points', value: numPoints.toString(), unit: '', color: 'text-blue-400' },
      ]}
      onStartTest={onStart} onStopTest={onStop} onPauseTest={onPause}
    />
  );
}
