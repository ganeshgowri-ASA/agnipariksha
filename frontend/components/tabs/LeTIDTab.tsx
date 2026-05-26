'use client';

import { useState, useCallback } from 'react';
import TestTabLayout from '../TestTabLayout';
import SchematicViewer from '../SchematicViewer';
import LiveChart from '../LiveChart';
import type { TestSession, LiveReading } from '@/types/test-session';
import LetidAnalysisPanel from '@/features/letid/analysis/LetidAnalysisPanel';
import { DEMO_LETID_POINTS } from '@/features/letid/analysis/demoData';
import type { LetidPoint } from '@/features/letid/analysis/regeneration';

interface Props {
  readings: LiveReading[];
  session: TestSession | null;
  onSessionUpdate: (s: TestSession | null) => void;
  sendCommand: (cmd: string) => void;
  demoMode: boolean;
}

export default function LeTIDTab({ readings, session, onSessionUpdate, sendCommand, demoMode }: Props) {
  const [isc, setIsc] = useState(10.0);
  const [imp, setImp] = useState(9.5);
  const [temp, setTemp] = useState(75);
  const [duration, setDuration] = useState(162); // hours per IEC TS 63342
  const [phase, setPhase] = useState<'light_soak' | 'degradation' | 'recovery'>('light_soak');

  // Idark = Isc - Imp (IEC TS 63342)
  const idark = +(isc - imp).toFixed(3);
  const elapsedHr = session ? ((Date.now() - session.startTime) / 3600000).toFixed(1) : '0.0';
  const progressPct = duration > 0 ? Math.min(100, (parseFloat(elapsedHr) / duration) * 100) : 0;

  const onStart = useCallback(() => {
    const newSession: TestSession = {
      id: `LETID-${Date.now()}`, testType: 'letid',
      startTime: Date.now(), status: 'running', readings: [],
    };
    onSessionUpdate(newSession);
    // Phase 1: Light soak at Isc, 75°C
    sendCommand(`SOUR:CURR ${isc}`);
    sendCommand(`SOUR:TEMP ${temp}`);
    sendCommand('OUTP ON');
    sendCommand(`PROG:LETID:DARK ${idark},${temp},${duration}`);
    sendCommand('PROG:EXEC');
  }, [isc, imp, temp, duration, idark, onSessionUpdate, sendCommand]);

  const onStop = useCallback(() => {
    if (!session) return;
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
        <h3 className="text-sm font-bold text-purple-400 mb-3">Light- and elevated-Temperature-Induced Degradation (LeTID) — IEC TS 63342</h3>
        <p className="text-xs text-gray-400 mb-4">
          Light and elevated Temperature Induced Degradation. Dark current Iₚₐ⭣₉ = Isc − Imp.
          Temperature = 75°C ± 3°C. Duration ≥ 162 hours.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Isc (A)', value: isc, set: setIsc, min: 0.1, max: 50, step: 0.1, unit: 'A' },
            { label: 'Imp (A)', value: imp, set: setImp, min: 0.1, max: 50, step: 0.1, unit: 'A' },
            { label: 'Temperature (°C)', value: temp, set: setTemp, min: 70, max: 80, step: 1, unit: '°C' },
            { label: 'Duration (hr)', value: duration, set: setDuration, min: 100, max: 500, step: 1, unit: 'hr' },
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
        <div className="mt-3 bg-purple-900/30 border border-purple-700/40 rounded p-3">
          <p className="text-xs text-purple-300">
            ● Calculated Iₚₐ⭣₉ = {isc} − {imp} = <strong>{idark} A</strong>
          </p>
          <p className="text-xs text-purple-300 mt-1">
            ● Test duration: {duration} hr ≈ {(duration / 24).toFixed(1)} days
          </p>
        </div>
      </div>
      <SchematicViewer testCode="letid" mode="chamber" />
    </div>
  );

  // IEC TS 63342 — dark V_oc regeneration. No live dark-V_oc capture exists
  // yet, so in DEMO with no active session we seed a synthetic curve so
  // reviewers see onset + stop-criterion detection firing.
  const analysisPoints: LetidPoint[] = demoMode && !session ? DEMO_LETID_POINTS : [];

  return (
    <TestTabLayout
      testKey="letid" testName="LeTID" standard="IEC TS 63342:2022"
      color="text-purple-400" readings={readings} session={session}
      onSessionUpdate={onSessionUpdate} sendCommand={sendCommand} demoMode={demoMode}
      limits={{ maxVoltage: 100, maxCurrent: 20, maxPower: 2000, maxTemp: 85 }}
      setupPanel={setupPanel}
      analysisPanel={<LetidAnalysisPanel points={analysisPoints} tjmaxc={temp} />}
      extraStats={[
        { label: 'Iₚₐ⭣₉ Dark', value: idark.toString(), unit: 'A', color: 'text-purple-400' },
        { label: 'Temperature', value: temp.toString(), unit: '°C', color: 'text-red-400' },
        { label: 'Elapsed', value: elapsedHr, unit: 'hr', color: 'text-yellow-400' },
        { label: 'Progress', value: progressPct.toFixed(1), unit: '%', color: 'text-green-400' },
      ]}
      onStartTest={onStart} onStopTest={onStop} onPauseTest={onPause}
    />
  );
}
