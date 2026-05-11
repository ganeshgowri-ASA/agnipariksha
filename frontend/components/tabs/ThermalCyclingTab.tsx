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

export default function ThermalCyclingTab({ readings, session, onSessionUpdate, sendCommand, demoMode }: Props) {
  const [cycles, setCycles] = useState(200);
  const [tMin, setTMin] = useState(-40);
  const [tMax, setTMax] = useState(85);
  const [isc, setIsc] = useState(10.0);
  const [rampRate, setRampRate] = useState(100); // °C/hr max per IEC 61215

  const completedCycles = session ? Math.floor(session.readings.length / 10) : 0;
  const progress = cycles > 0 ? Math.min(100, (completedCycles / cycles) * 100) : 0;

  const onStart = useCallback(() => {
    const newSession: TestSession = {
      id: `TC-${Date.now()}`, testType: 'thermal_cycling',
      startTime: Date.now(), status: 'running', readings: [],
    };
    onSessionUpdate(newSession);
    sendCommand(`SOUR:CURR ${isc}`);
    sendCommand('OUTP ON');
    sendCommand(`PROG:STEP 1,${tMin},${tMax},${rampRate}`);
    sendCommand(`PROG:REPE ${cycles}`);
    sendCommand('PROG:EXEC');
  }, [cycles, tMin, tMax, isc, rampRate, onSessionUpdate, sendCommand]);

  const onStop = useCallback(() => {
    if (!session) return;
    sendCommand('PROG:STOP');
    sendCommand('OUTP OFF');
    onSessionUpdate({ ...session, status: 'pass', endTime: Date.now(), result: 'PASS' });
  }, [session, onSessionUpdate, sendCommand]);

  const onPause = useCallback(() => {
    if (!session) return;
    sendCommand('PROG:PAUS');
    onSessionUpdate({ ...session, status: 'paused' });
  }, [session, onSessionUpdate, sendCommand]);

  const setupPanel = (
    <div className="space-y-4">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-bold text-orange-400 mb-3">IEC 61215-2 MQT 11 — Thermal Cycling</h3>
        <p className="text-xs text-gray-400 mb-4">
          200 cycles between −40°C and +85°C. Current = Isc. Temperature ramp ≤ 100°C/hr.
          Dwell at each extreme ≥ 10 min.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Number of Cycles', value: cycles, set: setCycles, min: 1, max: 1000, step: 1, unit: 'cycles' },
            { label: 'Tₘᴵₙ (°C)', value: tMin, set: setTMin, min: -60, max: 0, step: 1, unit: '°C' },
            { label: 'Tₘₐˣ (°C)', value: tMax, set: setTMax, min: 50, max: 110, step: 1, unit: '°C' },
            { label: 'Isc (A)', value: isc, set: setIsc, min: 0.1, max: 50, step: 0.1, unit: 'A' },
            { label: 'Ramp Rate', value: rampRate, set: setRampRate, min: 10, max: 100, step: 5, unit: '°C/hr' },
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
      </div>
      <div className="bg-blue-900/20 border border-blue-700/40 rounded p-3 text-xs text-blue-300">
        ℹ️ SCPI sequence: SOUR:CURR {isc}A → OUTP ON → PROG:STEP 1,{tMin},{tMax},{rampRate} → PROG:REPE {cycles} → PROG:EXEC
      </div>
    </div>
  );

  const extraStats = [
    { label: 'Cycles Target', value: cycles.toString(), unit: 'cycles', color: 'text-orange-400' },
    { label: 'Completed', value: completedCycles.toString(), unit: 'cycles', color: 'text-green-400' },
    { label: 'Progress', value: progress.toFixed(1), unit: '%', color: 'text-blue-400' },
    { label: 'T Range', value: `${tMin} to ${tMax}`, unit: '°C', color: 'text-yellow-400' },
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
