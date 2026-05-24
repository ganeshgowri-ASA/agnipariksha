'use client';

import { useState, useCallback, useMemo } from 'react';
import TestTabLayout from '../TestTabLayout';
import BdtAnalysis from '../BdtAnalysis';
import type { BdtMode, DiodeMeasurement } from '@/lib/bdt-regression';
import type { TestSession, LiveReading } from '@/types/test-session';

interface Props {
  readings: LiveReading[];
  session: TestSession | null;
  onSessionUpdate: (s: TestSession | null) => void;
  sendCommand: (cmd: string) => void;
  demoMode: boolean;
}

export default function BypassDiodeTab({ readings, session, onSessionUpdate, sendCommand, demoMode }: Props) {
  const [isc, setIsc] = useState(10.0);
  const [numDiodes, setNumDiodes] = useState(3);
  const [ambientTemp, setAmbientTemp] = useState(75); // IEC 62979 test temp
  const [duration, setDuration] = useState(1); // hours per diode
  const [currentDiode, setCurrentDiode] = useState(1);
  const [mode, setMode] = useState<BdtMode>('IEC 62979');
  const [tjmax, setTjmax] = useState(175); // recipe Tjmax for MQT 18.1 extrapolation

  const onStart = useCallback(() => {
    const newSession: TestSession = {
      id: `BDT-${Date.now()}`, testType: 'bypass_diode',
      startTime: Date.now(), status: 'running', readings: [],
    };
    onSessionUpdate(newSession);
    sendCommand(`SOUR:CURR ${isc}`);
    sendCommand('OUTP ON');
    sendCommand(`PROG:BDT:DIODES ${numDiodes},${ambientTemp},${duration}`);
    sendCommand('PROG:EXEC');
  }, [isc, numDiodes, ambientTemp, duration, onSessionUpdate, sendCommand]);

  const onStop = useCallback(() => {
    if (!session) return;
    sendCommand('OUTP OFF');
    onSessionUpdate({ ...session, status: 'pass', endTime: Date.now(), result: 'PASS' });
  }, [session, onSessionUpdate, sendCommand]);

  const onPause = useCallback(() => {
    if (!session) return;
    onSessionUpdate({ ...session, status: 'paused' });
  }, [session, onSessionUpdate, sendCommand]);

  // MQT 18.1 derives per-diode (T_j, V_drop) samples from the session
  // stream: readings are partitioned into contiguous per-diode segments,
  // mapping measured temperature → T_j and measured voltage → V_drop.
  const diodeMeasurements = useMemo<DiodeMeasurement[]>(() => {
    const src = session?.readings ?? [];
    const usable = src.filter(r => r.temperature !== undefined);
    if (usable.length === 0 || numDiodes < 1) return [];
    const per = Math.ceil(usable.length / numDiodes);
    return Array.from({ length: numDiodes }, (_, i) => ({
      diodeId: `D${i + 1}`,
      points: usable.slice(i * per, (i + 1) * per).map(r => ({
        tj: r.temperature as number,
        vdrop: r.voltage,
      })),
    })).filter(d => d.points.length > 0);
  }, [session?.readings, numDiodes]);

  const analysisPanel = mode === 'MQT 18.1'
    ? <BdtAnalysis diodes={diodeMeasurements} recipe={{ mode, Tjmax: tjmax }} />
    : undefined;

  const setupPanel = (
    <div className="space-y-4">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-gray-400">Analysis mode</span>
          <div className="flex gap-1" role="radiogroup" aria-label="BDT analysis mode">
            {(['IEC 62979', 'MQT 18.1'] as BdtMode[]).map(m => (
              <button
                key={m} type="button" role="radio" aria-checked={mode === m}
                data-testid={`bdt-mode-${m === 'MQT 18.1' ? 'mqt181' : 'iec62979'}`}
                onClick={() => setMode(m)}
                className={`px-2.5 py-1 text-xs rounded font-semibold transition-colors ${
                  mode === m ? 'bg-yellow-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        {mode === 'MQT 18.1' && (
          <div className="mb-3">
            <label className="text-xs text-gray-400 block mb-1">Tjmax (°C) — fit extrapolation target</label>
            <input
              type="number" value={tjmax} min={25} max={250} step={1}
              data-testid="bdt-tjmax"
              onChange={e => setTjmax(Number(e.target.value))}
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200"
            />
          </div>
        )}
        <h3 className="text-sm font-bold text-yellow-400 mb-3">IEC 62979:2017 — Bypass Diode Thermal Test</h3>
        <p className="text-xs text-gray-400 mb-4">
          Each bypass diode stressed at Isc for 1 hour at 75°C ambient.
          Monitors for thermal runaway (junction temp &gt; 128°C).
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Isc (A)', value: isc, set: setIsc, min: 0.1, max: 50, step: 0.1, unit: 'A' },
            { label: 'No. of Diodes', value: numDiodes, set: setNumDiodes, min: 1, max: 10, step: 1, unit: '' },
            { label: 'Ambient Temp (°C)', value: ambientTemp, set: setAmbientTemp, min: 20, max: 85, step: 1, unit: '°C' },
            { label: 'Duration (hr)', value: duration, set: setDuration, min: 0.5, max: 5, step: 0.5, unit: 'hr' },
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
        <div className="mt-3 bg-yellow-900/20 border border-yellow-700/40 rounded p-3">
          <p className="text-xs text-yellow-300">
            ⚠️ FAIL if Tˇᵤₙᶜ ≥ 128°C (thermal runaway limit per IEC 62979)
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <TestTabLayout
      testKey="bdt" testName="Bypass Diode Thermal" standard="IEC 62979:2017"
      color="text-yellow-400" readings={readings} session={session}
      onSessionUpdate={onSessionUpdate} sendCommand={sendCommand} demoMode={demoMode}
      limits={{ maxVoltage: 100, maxCurrent: 20, maxPower: 2000, maxTemp: 130 }}
      setupPanel={setupPanel} analysisPanel={analysisPanel} extraStats={[
        { label: 'Diodes', value: numDiodes.toString(), unit: '', color: 'text-yellow-400' },
        { label: 'Active Diode', value: currentDiode.toString(), unit: `/ ${numDiodes}`, color: 'text-orange-400' },
        { label: 'Ambient', value: ambientTemp.toString(), unit: '°C', color: 'text-red-400' },
        { label: 'Duration', value: duration.toString(), unit: 'hr', color: 'text-green-400' },
      ]}
      onStartTest={onStart} onStopTest={onStop} onPauseTest={onPause}
    />
  );
}
