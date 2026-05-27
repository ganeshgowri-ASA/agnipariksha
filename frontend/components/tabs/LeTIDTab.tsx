'use client';

import { useState, useCallback } from 'react';
import TestTabLayout from '../TestTabLayout';
import SchematicViewer from '../SchematicViewer';
import LiveChart from '../LiveChart';
import type { TestSession, LiveReading } from '@/types/test-session';
import LetidAnalysisPanel from '@/features/letid/analysis/LetidAnalysisPanel';
import PmaxCheckpointPanel from '@/features/letid/checkpoints/PmaxCheckpointPanel';
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
  // IEC TS 63342: forward current injection at elevated module temperature.
  const [injection, setInjection] = useState(10.0); // A, default ≈ Isc at STC
  const [temp, setTemp] = useState(75);             // °C, 75 ± 2
  const [duration, setDuration] = useState(162);    // h, 100–200
  const [checkpointsText, setCheckpointsText] = useState('0, 4, 8, 16, 32, 64, 96, 128, 162');

  // Editable checkpoint-hour list → sorted, de-duplicated, in-range numbers.
  const checkpoints = [...new Set(checkpointsText.split(',').map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= duration))].sort((a, b) => a - b);

  const elapsedHr = session ? ((Date.now() - session.startTime) / 3600000).toFixed(1) : '0.0';
  const progressPct = duration > 0 ? Math.min(100, (parseFloat(elapsedHr) / duration) * 100) : 0;

  const onStart = useCallback(() => {
    const newSession: TestSession = {
      id: `LETID-${Date.now()}`, testType: 'letid',
      startTime: Date.now(), status: 'running', readings: [],
    };
    onSessionUpdate(newSession);
    // Forward current injection at elevated temperature (IEC TS 63342).
    sendCommand(`SOUR:CURR ${injection}`);
    sendCommand(`SOUR:TEMP ${temp}`);
    sendCommand('OUTP ON');
    sendCommand(`PROG:LETID ${injection},${temp},${duration}`);
    sendCommand('PROG:EXEC');
  }, [injection, temp, duration, onSessionUpdate, sendCommand]);

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
          Forward current injection at elevated module temperature (75 °C ± 2).
          Pmax is sampled at the checkpoint hours below; PASS if Pmax(end)/Pmax(0) ≥ 0.95.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Injection current (A)', value: injection, set: setInjection, min: 1, max: 20, step: 0.1, unit: 'A' },
            { label: 'Module temp (°C)', value: temp, set: setTemp, min: 73, max: 77, step: 0.5, unit: '°C' },
            { label: 'Total duration (h)', value: duration, set: setDuration, min: 100, max: 200, step: 1, unit: 'h' },
          ].map(f => (
            <div key={f.label}>
              <label className="text-xs text-gray-400 block mb-1">{f.label}</label>
              <div className="flex gap-2 items-center">
                <input type="number" value={f.value} min={f.min} max={f.max} step={f.step} required
                  onChange={e => f.set(Number(e.target.value))}
                  className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200" />
                <span className="text-xs text-gray-500 w-12">{f.unit}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3">
          <label className="text-xs text-gray-400 block mb-1">Checkpoint hours (comma-separated)</label>
          <input type="text" value={checkpointsText}
            onChange={e => setCheckpointsText(e.target.value)}
            data-testid="letid-checkpoints-input"
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200 font-mono" />
        </div>
        <div className="mt-3 bg-purple-900/30 border border-purple-700/40 rounded p-3">
          <p className="text-xs text-purple-300">
            ● {checkpoints.length} checkpoints (≤ {duration} h): <strong>{checkpoints.join(', ') || '—'}</strong>
          </p>
          <p className="text-xs text-purple-300 mt-1">
            ● Test duration: {duration} h ≈ {(duration / 24).toFixed(1)} days
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
      analysisPanel={(
        <div className="space-y-4">
          <PmaxCheckpointPanel injectionA={injection} tempC={temp} durationH={duration} checkpoints={checkpoints} />
          <LetidAnalysisPanel points={analysisPoints} tjmaxc={temp} />
        </div>
      )}
      extraStats={[
        { label: 'Injection', value: injection.toString(), unit: 'A', color: 'text-purple-400' },
        { label: 'Temperature', value: temp.toString(), unit: '°C', color: 'text-red-400' },
        { label: 'Checkpoints', value: checkpoints.length.toString(), unit: '', color: 'text-cyan-400' },
        { label: 'Progress', value: progressPct.toFixed(1), unit: '%', color: 'text-green-400' },
      ]}
      onStartTest={onStart} onStopTest={onStop} onPauseTest={onPause}
    />
  );
}
