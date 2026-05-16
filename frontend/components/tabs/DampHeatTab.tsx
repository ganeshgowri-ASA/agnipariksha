'use client';

import { useState, useCallback } from 'react';
import TestTabLayout from '../TestTabLayout';
import ModuleIdField from '../ModuleIdField';
import type { TestSession, LiveReading } from '@/types/test-session';

interface Props {
  readings: LiveReading[];
  session: TestSession | null;
  onSessionUpdate: (s: TestSession | null) => void;
  sendCommand: (cmd: string) => void;
  demoMode: boolean;
}

export default function DampHeatTab({ readings, session, onSessionUpdate, sendCommand, demoMode }: Props) {
  const [tempC, setTempC] = useState(85);
  const [rhPct, setRhPct] = useState(85);
  const [durationHours, setDurationHours] = useState(1000);
  const [biasVoltage, setBiasVoltage] = useState(0);

  const elapsedH = session
    ? Math.max(0, (Date.now() - session.startTime) / 3_600_000)
    : 0;
  const progress = durationHours > 0 ? Math.min(100, (elapsedH / durationHours) * 100) : 0;

  const onStart = useCallback(() => {
    const newSession: TestSession = {
      id: `DH-${Date.now()}`,
      testType: 'damp_heat',
      startTime: Date.now(),
      status: 'running',
      readings: [],
      iecClause: 'IEC 61215-2 MQT 13',
    };
    onSessionUpdate(newSession);
    sendCommand('SOUR:FUNC:MODE CV');
    sendCommand(`SOUR:VOLT ${biasVoltage}`);
    sendCommand('OUTP ON');
    sendCommand(`PROG:DH:RUN ${tempC},${rhPct},${durationHours}`);
    sendCommand('PROG:EXEC');
  }, [tempC, rhPct, durationHours, biasVoltage, onSessionUpdate, sendCommand]);

  const onStop = useCallback(() => {
    if (!session) return;
    sendCommand('OUTP OFF');
    onSessionUpdate({ ...session, status: 'pass', endTime: Date.now(), result: 'PASS' });
  }, [session, onSessionUpdate, sendCommand]);

  const onPause = useCallback(() => {
    if (!session) return;
    onSessionUpdate({ ...session, status: 'paused' });
  }, [session, onSessionUpdate]);

  const setupPanel = (
    <div className="space-y-4">
      <ModuleIdField accentColor="text-cyan-400" />
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-bold text-cyan-400 mb-3">IEC 61215-2 MQT 13 — Damp Heat</h3>
        <p className="text-xs text-gray-400 mb-4">
          Sustained {tempC}°C / {rhPct}%RH for {durationHours} hours.
          Pmax decay vs initial baseline must stay within Gate-2 tolerance.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Temp (°C)',     value: tempC,         set: setTempC,         min: 40, max: 100, step: 1, unit: '°C' },
            { label: 'RH (%)',        value: rhPct,         set: setRhPct,         min: 40, max: 100, step: 1, unit: '%RH' },
            { label: 'Duration (hr)', value: durationHours, set: setDurationHours, min: 1,  max: 5000, step: 1, unit: 'hr' },
            { label: 'Bias (V)',      value: biasVoltage,   set: setBiasVoltage,   min: 0,  max: 1500, step: 1, unit: 'V' },
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
        </div>
        <div className="mt-4 text-xs text-gray-500">
          Elapsed: <span className="font-mono text-gray-300">{elapsedH.toFixed(1)} hr</span>
          {' · '}Progress: <span className="font-mono text-cyan-400">{progress.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );

  return (
    <TestTabLayout
      testKey="dh" testName="Damp Heat" standard="IEC 61215-2 MQT 13"
      color="text-cyan-400" readings={readings} session={session}
      onSessionUpdate={onSessionUpdate} sendCommand={sendCommand} demoMode={demoMode}
      limits={{ maxVoltage: 1500, maxCurrent: 20, maxPower: 6000, maxTemp: 100 }}
      setupPanel={setupPanel} extraStats={[
        { label: 'Temp', value: tempC.toString(), unit: '°C', color: 'text-orange-400' },
        { label: 'RH', value: rhPct.toString(), unit: '%', color: 'text-cyan-400' },
        { label: 'Elapsed', value: elapsedH.toFixed(1), unit: 'hr', color: 'text-blue-400' },
        { label: 'Progress', value: progress.toFixed(1), unit: '%', color: 'text-green-400' },
      ]}
      onStartTest={onStart} onStopTest={onStop} onPauseTest={onPause}
    />
  );
}
