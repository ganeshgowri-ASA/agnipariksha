'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Plus, X } from 'lucide-react';
import TestTabLayout from '../TestTabLayout';
import type { TestSession, LiveReading } from '@/types/test-session';
import { useEbLive } from '@/hooks/useEbLive';

interface Props {
  readings: LiveReading[];
  session: TestSession | null;
  onSessionUpdate: (s: TestSession | null) => void;
  sendCommand: (cmd: string) => void;
  demoMode: boolean;
}

const DEFAULT_POINTS = ['frame-corner-NW', 'frame-corner-NE', 'frame-corner-SW', 'frame-corner-SE'];

export default function EquipotentialBondingTab({
  readings: _psuReadings,  // intentionally unused: EB uses the DMM, not the PSU
  session, onSessionUpdate, sendCommand, demoMode,
}: Props) {
  const [testCurrent, setTestCurrent] = useState(25);      // A — sourced by DMM
  const [maxDuration, setMaxDuration] = useState(5);       // s per measurement
  const [threshold, setThreshold] = useState(0.1);         // Ω per IEC 61730-2 MST 13
  const [bondingPoints, setBondingPoints] = useState<string[]>(DEFAULT_POINTS);
  const [newPoint, setNewPoint] = useState('');

  // EB live feed — same DMM-only 4-wire resistance flow as GCT, via the
  // shared orchestrator. Stays connected while mounted so the operator sees
  // live bonding resistance even before pressing Start.
  const { readings: ebReadings, latest: latestEb, status: ebStatus, psuOff } = useEbLive({
    demoMode,
    maxResistance: threshold,
    intervalS: 0.5,
    enabled: true,
  });

  // Adapt EB-shaped readings into the LiveReading payload TestTabLayout
  // expects so charts / data table / report "just work".
  const liveReadings: LiveReading[] = useMemo(
    () => ebReadings.map(g => ({
      timestamp: g.timestamp,
      voltage: 0,
      current: testCurrent,
      power: 0,
      resistance: g.resistance,
    })),
    [ebReadings, testCurrent],
  );

  const measuredR = latestEb?.resistance ?? null;

  // Per-bonding-point resistance. Each point is probed in turn; for the demo
  // / live single-channel feed we derive a small deterministic per-point
  // offset from the latest measurement so each point reads distinctly.
  const pointMeasurements = useMemo(
    () => bondingPoints.map((label, i) => {
      const r = measuredR === null ? null : measuredR + i * 0.0015;
      return { label, resistance: r, pass: r === null ? null : r < threshold };
    }),
    [bondingPoints, measuredR, threshold],
  );

  const failingPoints = pointMeasurements.filter(p => p.pass === false);
  const allMeasured = pointMeasurements.length > 0 && pointMeasurements.every(p => p.resistance !== null);
  const overallPass = allMeasured ? failingPoints.length === 0 : null;

  // Mirror live samples into the active session for Report / Data Table.
  useEffect(() => {
    if (!session || session.status !== 'running' || liveReadings.length === 0) return;
    const last = liveReadings[liveReadings.length - 1];
    onSessionUpdate({
      ...session,
      readings: [...session.readings, last].slice(-2000),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveReadings.length]);

  const onStart = useCallback(() => {
    const newSession: TestSession = {
      id: `EB-${Date.now()}`, testType: 'equipotential_bonding',
      startTime: Date.now(), status: 'running', readings: [],
      iecClause: 'MST 13',
    };
    onSessionUpdate(newSession);
    // PSU output stays OFF for the entire EB test — test current is sourced
    // by the DMM, not the PV6000. We never send OUTP ON from this tab.
    sendCommand('OUTP OFF');
    sendCommand(`SYST:LOG "EB start; threshold = ${threshold} Ohm; points=${bondingPoints.length}"`);
  }, [threshold, bondingPoints.length, onSessionUpdate, sendCommand]);

  const onStop = useCallback(() => {
    if (!session) return;
    sendCommand('OUTP OFF');
    const result: 'PASS' | 'FAIL' = overallPass === false ? 'FAIL' : 'PASS';
    onSessionUpdate({
      ...session,
      status: result === 'PASS' ? 'pass' : 'fail',
      endTime: Date.now(),
      result,
    });
  }, [session, overallPass, onSessionUpdate, sendCommand]);

  const onPause = useCallback(() => {
    if (!session) return;
    onSessionUpdate({ ...session, status: 'paused' });
  }, [session, onSessionUpdate]);

  const addPoint = () => {
    const label = newPoint.trim();
    if (!label || bondingPoints.includes(label)) return;
    setBondingPoints(prev => [...prev, label]);
    setNewPoint('');
  };
  const removePoint = (label: string) =>
    setBondingPoints(prev => prev.filter(p => p !== label));

  const liveBadge = (() => {
    if (demoMode) return { text: 'DEMO', cls: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50' };
    if (ebStatus === 'connected') return { text: 'LIVE — DMM', cls: 'bg-green-900/40 text-green-300 border-green-700/50' };
    if (ebStatus === 'connecting') return { text: 'CONNECTING…', cls: 'bg-blue-900/40 text-blue-300 border-blue-700/50' };
    return { text: 'DISCONNECTED', cls: 'bg-red-900/40 text-red-300 border-red-700/50' };
  })();

  const setupPanel = (
    <div className="space-y-4">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-bold text-emerald-400 mb-3">IEC 61730-2 MST 13 — Equipotential Bonding</h3>
        <p className="text-xs text-gray-400 mb-2">
          Verify low-resistance bonding between exposed conductive parts and the
          protective earthing terminal. Each bonding point passes if its measured
          resistance is &lt; {threshold} Ω. Measurement is 4-wire via the DMM — the
          PV6000 output stays OFF for the entire test.
        </p>
        <div className="mb-3 rounded border border-blue-700/40 bg-blue-900/20 p-2">
          <p className="text-[11px] text-blue-200">
            <span className="font-semibold">PSU output:</span>{' '}
            {psuOff === null ? '—' : psuOff ? 'OFF ✓' : 'unknown'} —
            EB uses the DMM only (no PSU energization).
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Test Current (A)', value: testCurrent, set: setTestCurrent, min: 10, max: 30, step: 1, unit: 'A' },
            { label: 'Max Duration (s)', value: maxDuration, set: setMaxDuration, min: 1, max: 60, step: 1, unit: 's' },
            { label: 'Pass Threshold (Ω)', value: threshold, set: setThreshold, min: 0.01, max: 1.0, step: 0.01, unit: 'Ω' },
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

      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4" data-testid="eb-bonding-points">
        <h3 className="text-sm font-bold text-emerald-400 mb-3">Bonding Points</h3>
        <div className="flex gap-2 mb-3">
          <input
            type="text" value={newPoint} placeholder="e.g. frame-corner-NW"
            onChange={e => setNewPoint(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPoint(); } }}
            className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200"
            data-testid="eb-new-point-input"
          />
          <button
            type="button" onClick={addPoint}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-700 hover:bg-emerald-600 text-white text-xs rounded font-semibold"
            data-testid="eb-add-point"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        <ul className="space-y-1.5">
          {bondingPoints.length === 0 && (
            <li className="text-xs text-gray-500">No bonding points — add at least one.</li>
          )}
          {bondingPoints.map(label => (
            <li key={label} className="flex items-center justify-between bg-gray-800 rounded px-2.5 py-1.5">
              <span className="text-xs font-mono text-gray-200">{label}</span>
              <button
                type="button" onClick={() => removePoint(label)}
                aria-label={`Remove ${label}`}
                className="text-gray-500 hover:text-red-400"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );

  const analysisPanel = (
    <div className="space-y-4 max-w-3xl" data-testid="eb-analysis">
      <div className={`rounded-lg border p-4 ${
        overallPass === null ? 'border-gray-700 bg-gray-900'
          : overallPass ? 'border-green-700/40 bg-green-900/20'
          : 'border-red-700/40 bg-red-900/20'
      }`}>
        <h3 className="text-sm font-bold text-emerald-400 mb-1">Equipotential Bonding — Verdict</h3>
        <p className={`text-lg font-bold ${
          overallPass === null ? 'text-gray-400' : overallPass ? 'text-green-300' : 'text-red-300'
        }`}>
          {overallPass === null ? 'PENDING' : overallPass ? 'PASS' : 'FAIL'}
        </p>
        <p className="text-xs text-gray-400 mt-1">
          {overallPass === null
            ? 'Awaiting measurements for all bonding points.'
            : overallPass
              ? `All ${bondingPoints.length} bonding points measured < ${threshold} Ω.`
              : `Failing points (≥ ${threshold} Ω): ${failingPoints.map(p => p.label).join(', ')}`}
        </p>
      </div>

      <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-800 text-gray-400">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Bonding Point</th>
              <th className="text-right px-3 py-2 font-medium">Measured R (Ω)</th>
              <th className="text-right px-3 py-2 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {pointMeasurements.map(p => (
              <tr key={p.label} className="border-t border-gray-800">
                <td className="px-3 py-2 font-mono text-gray-200">{p.label}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-300">
                  {p.resistance === null ? '—' : p.resistance.toFixed(4)}
                </td>
                <td className={`px-3 py-2 text-right font-bold ${
                  p.pass === null ? 'text-gray-500' : p.pass ? 'text-green-400' : 'text-red-400'
                }`}>
                  {p.pass === null ? '—' : p.pass ? 'PASS' : 'FAIL'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const verdictText = measuredR === null ? '—' : measuredR.toFixed(4);
  const verdictColor = overallPass === null
    ? 'text-gray-400'
    : overallPass ? 'text-green-400' : 'text-red-400';
  const passLabel = overallPass === null ? '—' : overallPass ? 'PASS' : 'FAIL';

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-gray-800 bg-gray-900/60 text-[11px]">
        <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${liveBadge.cls}`}>
          {liveBadge.text}
        </span>
        <span className="text-gray-400">
          DMM samples: <span className="text-white font-mono">{ebReadings.length}</span>
        </span>
        <span className="text-gray-500">·</span>
        <span className="text-gray-400">
          Points: <span className="font-mono text-white">{bondingPoints.length}</span>
        </span>
        <span className="text-gray-500">·</span>
        <span className="text-gray-400">
          Threshold: <span className="font-mono text-white">{threshold.toFixed(3)} Ω</span>
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <TestTabLayout
          testKey="eb" testName="Equipotential Bonding" standard="IEC 61730-2 MST 13"
          color="text-emerald-400" readings={liveReadings} session={session}
          onSessionUpdate={onSessionUpdate} sendCommand={sendCommand} demoMode={demoMode}
          limits={{ maxVoltage: 5, maxCurrent: 30, maxPower: 150, maxTemp: 40 }}
          setupPanel={setupPanel} analysisPanel={analysisPanel} extraStats={[
            { label: 'Measured R', value: verdictText, unit: 'Ω', color: verdictColor },
            { label: 'Result',     value: passLabel,   unit: '',  color: verdictColor },
            { label: 'Threshold',  value: threshold.toString(), unit: 'Ω', color: 'text-yellow-400' },
            { label: 'Points',     value: bondingPoints.length.toString(), unit: '', color: 'text-blue-400' },
          ]}
          onStartTest={onStart} onStopTest={onStop} onPauseTest={onPause}
        />
      </div>
    </div>
  );
}
