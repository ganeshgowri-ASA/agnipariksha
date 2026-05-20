'use client';

import { useState } from 'react';
import TestTabLayout from '../TestTabLayout';
import type { TestSession, LiveReading } from '@/types/test-session';

interface Props {
  readings: LiveReading[];
  session: TestSession | null;
  onSessionUpdate: (s: TestSession | null) => void;
  sendCommand: (cmd: string) => void;
  demoMode: boolean;
}

// IEC TS 60904-13 Electroluminescence imaging — STUB.
// Capture button is intentionally disabled: live PSU energization
// requires PR #52 (live-psu-gate) plus camera SDK integration.
export default function ElTab({ readings, session, onSessionUpdate, sendCommand, demoMode }: Props) {
  const [moduleId, setModuleId] = useState('MOD-001');
  const [isc, setIsc] = useState(9.5);
  const [exposure, setExposure] = useState(500);
  const [gain, setGain] = useState(1.0);
  const noop = () => {};

  const setupPanel = (
    <div className="bg-gray-900 rounded-lg border border-gray-700 p-4 space-y-3">
      <h3 className="text-sm font-bold text-indigo-300">IEC TS 60904-13 — Electroluminescence Imaging</h3>
      <p className="text-xs text-gray-400">
        Forward-bias the module at Isc..1.2&times;Isc and capture an IR/NIR frame.
        Inspect for cracks, dead cells, finger interruptions. STUB only — camera
        SDK and live PSU gate (PR #52) pending.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-gray-400">Module ID
          <input type="text" value={moduleId} onChange={e => setModuleId(e.target.value)}
            className="mt-1 w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200" />
        </label>
        <label className="text-xs text-gray-400">Isc (A)
          <input type="number" value={isc} step={0.1} onChange={e => setIsc(Number(e.target.value))}
            className="mt-1 w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200" />
        </label>
        <label className="text-xs text-gray-400">Exposure (ms)
          <input type="number" value={exposure} step={50} onChange={e => setExposure(Number(e.target.value))}
            className="mt-1 w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200" />
        </label>
        <label className="text-xs text-gray-400">Gain
          <input type="number" value={gain} step={0.1} onChange={e => setGain(Number(e.target.value))}
            className="mt-1 w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200" />
        </label>
      </div>
      <button type="button" disabled onClick={noop} data-testid="el-capture-button"
        title="Disabled until live-psu-gate (PR #52) and camera SDK land"
        className="w-full bg-indigo-900/40 border border-indigo-700/40 text-indigo-200 text-xs rounded px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed">
        Capture EL frame (disabled — pending PR #52)
      </button>
    </div>
  );

  return (
    <TestTabLayout
      testKey="el" testName="Electroluminescence" standard="IEC TS 60904-13"
      color="text-indigo-300" readings={readings} session={session}
      onSessionUpdate={onSessionUpdate} sendCommand={sendCommand} demoMode={demoMode}
      limits={{ maxVoltage: 60, maxCurrent: 12, maxPower: 720 }}
      setupPanel={setupPanel}
      extraStats={[
        { label: 'Module ID', value: moduleId, unit: '', color: 'text-gray-300' },
        { label: 'Isc', value: isc.toFixed(2), unit: 'A', color: 'text-yellow-400' },
        { label: 'Exposure', value: exposure.toString(), unit: 'ms', color: 'text-blue-400' },
        { label: 'Gain', value: gain.toFixed(2), unit: 'x', color: 'text-indigo-300' },
      ]}
      onStartTest={noop} onStopTest={noop} onPauseTest={noop}
    />
  );
}
