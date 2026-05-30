'use client';

import { useState, useCallback } from 'react';
import TestTabLayout from '../TestTabLayout';
import SchematicViewer from '../SchematicViewer';
import HfAnalysisPanel from '@/features/hf/analysis/HfAnalysisPanel';
import { stampOperatorContext } from '@/lib/operator-store';
import type { TestSession, LiveReading } from '@/types/test-session';

interface Props {
  readings: LiveReading[];
  session: TestSession | null;
  onSessionUpdate: (s: TestSession | null) => void;
  sendCommand: (cmd: string) => void;
  demoMode: boolean;
}

export default function HumidityFreezeTab({ readings, session, onSessionUpdate, sendCommand, demoMode }: Props) {
  const [cycles, setCycles] = useState(10);
  const [tHigh, setTHigh] = useState(85);
  const [rhHigh, setRhHigh] = useState(85);
  const [tLow, setTLow] = useState(-40);
  const [dwellHours, setDwellHours] = useState(20);
  // Isc is shared with the TC tab semantics — default to the same 9.5 A so
  // the HF Analysis pane's Isc-gate pill reflects the operator's actual
  // chamber setpoint. Operators can tweak in the Setup field.
  const [isc, setIsc] = useState(9.5);

  const onStart = useCallback(() => {
    // Stamp operator/customer/equipment context (#128) so the IEC PDF
    // report header carries real values instead of "NA".
    const draft: TestSession = {
      id: `HF-${Date.now()}`, testType: 'humidity_freeze',
      startTime: Date.now(), status: 'running', readings: [],
      iecClause: 'MQT 12',
    };
    const newSession: TestSession = stampOperatorContext(draft);
    onSessionUpdate(newSession);
    sendCommand('SOUR:FUNC:MODE CV');
    sendCommand(`SOUR:VOLT 0`);
    sendCommand('OUTP ON');
    sendCommand(`PROG:HF:CYCL ${cycles},${tHigh},${rhHigh},${tLow},${dwellHours}`);
    sendCommand('PROG:EXEC');
  }, [cycles, tHigh, rhHigh, tLow, dwellHours, onSessionUpdate, sendCommand]);

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
        <h3 className="text-sm font-bold text-blue-400 mb-3">IEC 61215-2 MQT 12 — Humidity Freeze</h3>
        <p className="text-xs text-gray-400 mb-4">
          10 cycles: high temp+humidity ({tHigh}°C/{rhHigh}%RH, {dwellHours}hr dwell)
          then freeze to {tLow}°C.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Cycles', value: cycles, set: setCycles, min: 1, max: 50, step: 1, unit: '' },
            { label: 'High Temp (°C)', value: tHigh, set: setTHigh, min: 40, max: 100, step: 1, unit: '°C' },
            { label: 'RH (%)', value: rhHigh, set: setRhHigh, min: 60, max: 100, step: 1, unit: '%RH' },
            { label: 'Low Temp (°C)', value: tLow, set: setTLow, min: -60, max: 0, step: 1, unit: '°C' },
            { label: 'Dwell (hr)', value: dwellHours, set: setDwellHours, min: 1, max: 24, step: 1, unit: 'hr' },
            { label: 'Isc (A)', value: isc, set: setIsc, min: 0, max: 30, step: 0.1, unit: 'A' },
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
      <SchematicViewer testCode="hf" mode="chamber" />
    </div>
  );

  // IEC-aware Analysis pane — mirrors the TC tab pattern. Reads live
  // readings + setpoints and derives the four MQT 12 KPIs (cycles,
  // module T & RH chart, dwell durations, RH compliance, Isc gate).
  const analysisPanel = (
    <HfAnalysisPanel
      readings={readings}
      config={{ cycles, tHigh, rhHigh, tLow, dwellHours, isc }}
    />
  );

  return (
    <TestTabLayout
      testKey="hf" testName="Humidity Freeze" standard="IEC 61215-2 MQT 12"
      color="text-blue-400" readings={readings} session={session}
      onSessionUpdate={onSessionUpdate} sendCommand={sendCommand} demoMode={demoMode}
      limits={{ maxVoltage: 100, maxCurrent: 20, maxPower: 2000, maxTemp: 100 }}
      setupPanel={setupPanel}
      analysisPanel={analysisPanel}
      extraStats={[
        { label: 'Cycles', value: cycles.toString(), unit: '', color: 'text-blue-400' },
        { label: 'Target RH', value: rhHigh.toString(), unit: '%', color: 'text-cyan-400' },
        { label: 'T Range', value: `${tLow} to ${tHigh}`, unit: '°C', color: 'text-yellow-400' },
        { label: 'Dwell', value: dwellHours.toString(), unit: 'hr', color: 'text-green-400' },
      ]}
      onStartTest={onStart} onStopTest={onStop} onPauseTest={onPause}
    />
  );
}
