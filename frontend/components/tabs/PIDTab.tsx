'use client';

import { useState, useCallback } from 'react';
import TestTabLayout from '../TestTabLayout';
import PidAnalysisPanel from '@/features/pid/analysis/PidAnalysisPanel';
import type { TestSession, LiveReading } from '@/types/test-session';

import { stampOperatorContext } from '@/lib/operator-store';
interface Props {
  readings: LiveReading[];
  session: TestSession | null;
  onSessionUpdate: (s: TestSession | null) => void;
  sendCommand: (cmd: string) => void;
  demoMode: boolean;
}

export default function PIDTab({ readings, session, onSessionUpdate, sendCommand, demoMode }: Props) {
  const [biasVoltage, setBiasVoltage] = useState(-1000);
  const [tempC, setTempC] = useState(60);
  const [rhPct, setRhPct] = useState(85);
  const [durationHours, setDurationHours] = useState(96);

  const elapsedH = session
    ? Math.max(0, (Date.now() - session.startTime) / 3_600_000)
    : 0;
  const progress = durationHours > 0 ? Math.min(100, (elapsedH / durationHours) * 100) : 0;

  const onStart = useCallback(() => {
    const draft: TestSession = {
      id: `PID-${Date.now()}`,
      testType: 'potential_induced_degradation',
      startTime: Date.now(),
      status: 'running',
      readings: [],
      iecClause: 'IEC TS 62804-1',
    };

    // Stamp operator/customer/equipment context (#128) so reports stop saying "NA".

    const newSession: TestSession = stampOperatorContext(draft);
    onSessionUpdate(newSession);
    sendCommand('SOUR:FUNC:MODE CV');
    sendCommand(`SOUR:VOLT ${biasVoltage}`);
    sendCommand('OUTP ON');
    sendCommand(`PROG:PID:RUN ${biasVoltage},${tempC},${rhPct},${durationHours}`);
    sendCommand('PROG:EXEC');
  }, [biasVoltage, tempC, rhPct, durationHours, onSessionUpdate, sendCommand]);

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
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-bold text-fuchsia-400 mb-3">IEC TS 62804-1 — Potential Induced Degradation</h3>
        <p className="text-xs text-gray-400 mb-4">
          System-voltage stress of {biasVoltage} V at {tempC}°C / {rhPct}%RH for {durationHours} h
          (Method A). Pmax decay vs the initial baseline must stay within the Gate-2 tolerance (≤5%).
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Bias (V)',      value: biasVoltage,   set: setBiasVoltage,   min: -1500, max: 1500, step: 10, unit: 'V' },
            { label: 'Temp (°C)',     value: tempC,         set: setTempC,         min: 25,    max: 100,  step: 1,  unit: '°C' },
            { label: 'RH (%)',        value: rhPct,         set: setRhPct,         min: 0,     max: 100,  step: 1,  unit: '%RH' },
            { label: 'Duration (hr)', value: durationHours, set: setDurationHours, min: 1,     max: 1000, step: 1,  unit: 'hr' },
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
          {' · '}Progress: <span className="font-mono text-fuchsia-400">{progress.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );

  const analysisPanel = (
    <PidAnalysisPanel
      readings={readings}
      config={{ biasVoltage, tempC, rhPct, durationHours }}
    />
  );

  return (
    <TestTabLayout
      testKey="pid" testName="Potential Induced Degradation" standard="IEC TS 62804-1"
      color="text-fuchsia-400" readings={readings} session={session}
      onSessionUpdate={onSessionUpdate} sendCommand={sendCommand} demoMode={demoMode}
      limits={{ maxVoltage: 1500, maxCurrent: 5, maxPower: 7500, maxTemp: 100 }}
      setupPanel={setupPanel}
      analysisPanel={analysisPanel}
      extraStats={[
        { label: 'Bias', value: biasVoltage.toString(), unit: 'V', color: 'text-fuchsia-400' },
        { label: 'Temp', value: tempC.toString(), unit: '°C', color: 'text-orange-400' },
        { label: 'RH', value: rhPct.toString(), unit: '%', color: 'text-cyan-400' },
        { label: 'Progress', value: progress.toFixed(1), unit: '%', color: 'text-green-400' },
      ]}
      onStartTest={onStart} onStopTest={onStop} onPauseTest={onPause}
    />
  );
}
