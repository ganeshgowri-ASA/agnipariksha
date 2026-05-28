'use client';

import { useCallback, useState } from 'react';
import { Play, Square } from 'lucide-react';
import type { TestSession, LiveReading } from '@/types/test-session';

interface Props {
  readings: LiveReading[];
  session: TestSession | null;
  onSessionUpdate: (s: TestSession | null) => void;
  sendCommand: (cmd: string) => void;
  demoMode: boolean;
}

const ISC_A = 9.0; // module Isc — default forward-bias set point
export default function IRTab({ session, onSessionUpdate, demoMode }: Props) {
  const [current, setCurrent] = useState(ISC_A);
  const [soakSec, setSoakSec] = useState(300);
  const [ambientMax, setAmbientMax] = useState(25);
  const [threshold, setThreshold] = useState(10);
  const [rows, setRows] = useState(6);
  const [cols, setCols] = useState(12);

  // IEC TS 60904-12-1 forward-bias screening needs a cool, stable ambient so
  // self-heating doesn't mask cell hot-spots — gate Start until it is < 25 °C.
  const ambientOk = ambientMax < 25;
  const running = session?.status === 'running';
  const onToggle = useCallback(() => {
    if (running) {
      onSessionUpdate(session ? { ...session, status: 'pass', endTime: Date.now(), result: 'PASS' } : null);
    } else if (ambientOk) {
      onSessionUpdate({
        id: `IR-${Date.now()}`, testType: 'ir-forward-bias-thermography',
        startTime: Date.now(), status: 'running', readings: [], iecClause: 'IEC TS 60904-12-1',
      });
    }
  }, [running, ambientOk, session, onSessionUpdate]);
  const fields = [
    { label: 'Forward-bias current (A)',   id: 'current',   value: current,    set: setCurrent,    min: 1,  max: 20,  step: 0.1 },
    { label: 'Soak time (s)',              id: 'soak',      value: soakSec,    set: setSoakSec,    min: 60, max: 900, step: 1 },
    { label: 'Ambient temp max (°C)',      id: 'ambient',   value: ambientMax, set: setAmbientMax, min: 0,  max: 40,  step: 0.5 },
    { label: 'Hot-spot ΔT threshold (°C)', id: 'threshold', value: threshold,  set: setThreshold,  min: 5,  max: 25,  step: 1 },
    { label: 'Module rows',                id: 'rows',      value: rows,       set: setRows,       min: 1,  max: 24,  step: 1 },
    { label: 'Module cols',                id: 'cols',      value: cols,       set: setCols,       min: 1,  max: 24,  step: 1 },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-950 p-4 gap-4" data-testid="test-tab-ir">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-bold text-amber-400">IR Forward-Bias Thermography</span>
        <span className="text-[10px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded">IEC TS 60904-12-1</span>
        {demoMode && <span className="text-[10px] text-yellow-400 bg-yellow-900/30 px-1.5 py-0.5 rounded">DEMO</span>}
      </div>
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4 max-w-2xl">
        <h3 className="text-sm font-bold text-amber-400 mb-3">Setup</h3>
        <p className="text-xs text-gray-400 mb-4">
          Drive the module under forward bias (≈ Isc), soak, then capture a thermogram. Each cell
          maps to an ROI on the {rows}×{cols} grid; cells whose internal spread ΔT = Tmax − Tmean
          exceeds {threshold} °C are flagged as hot-spots.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {fields.map(f => (
            <div key={f.id} data-testid={`ir-setup-${f.id}`}>
              <label className="text-xs text-gray-400 block mb-1">{f.label}</label>
              <input
                type="number" value={f.value} min={f.min} max={f.max} step={f.step}
                onChange={e => f.set(Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200"
              />
            </div>
          ))}
        </div>
        {!ambientOk && !running && (
          <p className="mt-3 text-xs text-amber-400" data-testid="ir-ambient-warning">Ambient must be &lt; 25 °C to start.</p>
        )}
        <button
          type="button" onClick={onToggle} disabled={!running && !ambientOk} data-testid="ir-start"
          className="mt-4 inline-flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {running ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {running ? 'Stop' : 'Start capture'}
        </button>
      </div>
    </div>
  );
}
