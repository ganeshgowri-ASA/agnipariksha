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

export default function ELTab({ readings, session, onSessionUpdate, sendCommand, demoMode }: Props) {
  const [injectionCurrent, setInjectionCurrent] = useState(9.0);
  const [exposureSec, setExposureSec] = useState(10);
  const [frames, setFrames] = useState(2);

  const onStart = useCallback(() => {
    const newSession: TestSession = {
      id: `EL-${Date.now()}`,
      testType: 'electroluminescence',
      startTime: Date.now(),
      status: 'running',
      readings: [],
      iecClause: 'IEC TS 60904-13',
    };
    onSessionUpdate(newSession);
    sendCommand('SOUR:FUNC:MODE CC');
    sendCommand(`SOUR:CURR ${injectionCurrent}`);
    sendCommand('OUTP ON');
    sendCommand(`PROG:EL:CAPTURE ${injectionCurrent},${exposureSec},${frames}`);
  }, [injectionCurrent, exposureSec, frames, onSessionUpdate, sendCommand]);

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
        <h3 className="text-sm font-bold text-sky-400 mb-3">IEC TS 60904-13 — Electroluminescence Imaging</h3>
        <p className="text-xs text-gray-400 mb-4">
          Forward-bias current injection at {injectionCurrent} A while a cooled camera captures
          {' '}{frames} EL frame(s) at {exposureSec}s exposure. Images are reviewed qualitatively for
          cracks, inactive cells and interconnect defects (stub — capture pipeline pending).
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Inject (A)',   value: injectionCurrent, set: setInjectionCurrent, min: 0, max: 30, step: 0.1, unit: 'A' },
            { label: 'Exposure (s)', value: exposureSec,      set: setExposureSec,      min: 1, max: 60, step: 1,   unit: 's' },
            { label: 'Frames',       value: frames,           set: setFrames,           min: 1, max: 10, step: 1,   unit: '' },
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
      </div>
    </div>
  );

  return (
    <TestTabLayout
      testKey="el" testName="Electroluminescence" standard="IEC TS 60904-13"
      color="text-sky-400" readings={readings} session={session}
      onSessionUpdate={onSessionUpdate} sendCommand={sendCommand} demoMode={demoMode}
      limits={{ maxVoltage: 60, maxCurrent: 30, maxPower: 1800 }}
      setupPanel={setupPanel} extraStats={[
        { label: 'Inject', value: injectionCurrent.toFixed(1), unit: 'A', color: 'text-sky-400' },
        { label: 'Exposure', value: exposureSec.toString(), unit: 's', color: 'text-blue-400' },
        { label: 'Frames', value: frames.toString(), unit: '', color: 'text-green-400' },
      ]}
      onStartTest={onStart} onStopTest={onStop} onPauseTest={onPause}
    />
  );
}
