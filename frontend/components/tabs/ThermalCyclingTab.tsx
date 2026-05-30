'use client';

import { useState, useCallback } from 'react';
import TestTabLayout from '../TestTabLayout';
import SchematicViewer from '../SchematicViewer';
import ThermalCyclingBasicCheck from '../ThermalCyclingBasicCheck';
import TcAnalysisPanel from '@/features/tc/analysis/TcAnalysisPanel';
import TcRampSetVsActualPanel from '@/features/tc/analysis/TcRampSetVsActualPanel';
import { MASS_LOADING_NOTE, POSITION_TOLERANCES, type ModulePosition } from '@/features/tc/analysis/tcExtensions';
import { stampOperatorContext } from '@/lib/operator-store';
import type { TestSession, LiveReading } from '@/types/test-session';

interface Props {
  readings: LiveReading[];
  session: TestSession | null;
  onSessionUpdate: (s: TestSession | null) => void;
  sendCommand: (cmd: string) => void;
  demoMode: boolean;
  /** Optional — passed through to the Basic Check status tower so the
   *  Frontend lamp reflects the dashboard's WebSocket state. Defaults
   *  to 'unknown' when not supplied (keeps callers backwards-compatible). */
  wsStatus?: string;
}

export default function ThermalCyclingTab({ readings, session, onSessionUpdate, sendCommand, demoMode, wsStatus = 'unknown' }: Props) {
  const [cycles, setCycles] = useState(200);
  const [tMin, setTMin] = useState(-40);
  const [tMax, setTMax] = useState(85);
  const [isc, setIsc] = useState(10.0);
  const [rampRate, setRampRate] = useState(100); // °C/hr max per IEC 61215
  // Junction-box / mounting mass loading (kg) — MQT 11 mounting method.
  // Declared so the mechanical load path is reproduced on the report.
  const [massLoadingKg, setMassLoadingKg] = useState(1.2);
  // Bifacial module position — selects the per-position tolerance set
  // (ramp ceiling / plateau band) that drives the ramp verdict (MQT 11.6).
  const [position, setPosition] = useState<ModulePosition>('BIFACIAL');

  const completedCycles = session ? Math.floor(session.readings.length / 10) : 0;
  const progress = cycles > 0 ? Math.min(100, (completedCycles / cycles) * 100) : 0;

  const onStart = useCallback(() => {
    // Stamp operator/customer/equipment context onto the session so the
    // PDF report header carries real values instead of "NA". The picker
    // lives in the AppHeader and persists in localStorage.
    const draft: TestSession = {
      id: `TC-${Date.now()}`, testType: 'thermal_cycling',
      startTime: Date.now(), status: 'running', readings: [],
      iecClause: 'MQT 11',
      // Persist the bifacial position + junction-box mass loading onto the
      // session so the IEC report header can cite the mounting configuration
      // (MQT 11 mounting / mass-loading) and the tolerance set in force.
      notes: `Position ${position} (≤${POSITION_TOLERANCES[position].maxRampCph} °C/h, ±${POSITION_TOLERANCES[position].tempToleranceC} °C) · junction-box mass loading ${massLoadingKg.toFixed(2)} kg`,
    };
    const newSession: TestSession = stampOperatorContext(draft);
    onSessionUpdate(newSession);
    sendCommand(`SOUR:CURR ${isc}`);
    sendCommand('OUTP ON');
    sendCommand(`PROG:STEP 1,${tMin},${tMax},${rampRate}`);
    sendCommand(`PROG:REPE ${cycles}`);
    sendCommand('PROG:EXEC');
  }, [cycles, tMin, tMax, isc, rampRate, position, massLoadingKg, onSessionUpdate, sendCommand]);

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

        {/* Bifacial module-position selector — each position carries its
            own tolerance set (ramp ceiling / plateau band) per MQT 11.6. */}
        <div className="mt-4">
          <label className="text-xs text-gray-400 block mb-1">
            Bifacial Module Position
            <span className="ml-2 font-mono text-[10px] text-gray-500">MQT 11.6.1 / 11.6.2</span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(POSITION_TOLERANCES) as ModulePosition[]).map(p => {
              const tol = POSITION_TOLERANCES[p];
              const active = position === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPosition(p)}
                  className={`rounded border px-2 py-1.5 text-left transition-colors ${
                    active
                      ? 'border-orange-500 bg-orange-900/20 text-orange-300'
                      : 'border-gray-600 bg-gray-800 text-gray-300 hover:border-gray-500'
                  }`}
                >
                  <div className="text-xs font-semibold">{p}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    ≤{tol.maxRampCph} °C/h · ±{tol.tempToleranceC} °C
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-500 mt-1">{POSITION_TOLERANCES[position].label}</p>
        </div>

        {/* Junction-box / mounting mass-loading (kg) — MQT 11 mounting. */}
        <div className="mt-4">
          <label className="text-xs text-gray-400 block mb-1">
            Junction-box Mass Loading
            <span className="ml-2 font-mono text-[10px] text-gray-500">MQT 11 mounting</span>
          </label>
          <div className="flex gap-2 items-center">
            <input
              type="number" value={massLoadingKg} min={0.01} max={50} step={0.1}
              onChange={e => setMassLoadingKg(Number(e.target.value))}
              className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200" />
            <span className="text-xs text-gray-500 w-12">kg</span>
          </div>
          <p className="text-[10px] text-gray-500 mt-1">{MASS_LOADING_NOTE}</p>
        </div>
      </div>
      <div className="bg-blue-900/20 border border-blue-700/40 rounded p-3 text-xs text-blue-300">
        ℹ️ SCPI sequence: SOUR:CURR {isc}A → OUTP ON → PROG:STEP 1,{tMin},{tMax},{rampRate} → PROG:REPE {cycles} → PROG:EXEC
      </div>
      <SchematicViewer testCode="tc" mode="chamber" />
    </div>
  );

  const extraStats = [
    { label: 'Cycles Target', value: cycles.toString(), unit: 'cycles', color: 'text-orange-400' },
    { label: 'Completed', value: completedCycles.toString(), unit: 'cycles', color: 'text-green-400' },
    { label: 'Progress', value: progress.toFixed(1), unit: '%', color: 'text-blue-400' },
    { label: 'T Range', value: `${tMin} to ${tMax}`, unit: '°C', color: 'text-yellow-400' },
  ];

  // The IEC-aware Analysis surface is two stacked panes that derive their
  // KPIs from the live `readings` stream (so DEMO and the real bench behave
  // identically):
  //   1. TcAnalysisPanel — ramp rate, cycle counter, Isc gate, module-T
  //      chart (see frontend/features/tc/analysis/tcAnalysis.ts).
  //   2. TcRampSetVsActualPanel — SET-vs-ACTUAL ramp (point-to-point &
  //      cumulative) driven by the selected bifacial position's tolerance
  //      set; also surfaces the junction-box mass loading so it reaches the
  //      report (see frontend/features/tc/analysis/tcExtensions.ts).
  const analysisPanel = (
    <div className="space-y-4">
      <TcAnalysisPanel
        readings={readings}
        config={{ cycles, tMin, tMax, rampRateCph: rampRate, isc }}
      />
      <TcRampSetVsActualPanel
        readings={readings}
        rampRateCph={rampRate}
        position={position}
        massLoadingKg={massLoadingKg}
      />
    </div>
  );

  return (
    <TestTabLayout
      testKey="tc" testName="Thermal Cycling" standard="IEC 61215-2 MQT 11"
      color="text-orange-400" readings={readings} session={session}
      onSessionUpdate={onSessionUpdate} sendCommand={sendCommand} demoMode={demoMode}
      limits={{ maxVoltage: 100, maxCurrent: 20, maxPower: 2000, maxTemp: 100 }}
      setupPanel={setupPanel}
      basicCheckPanel={<ThermalCyclingBasicCheck wsStatus={wsStatus} demoMode={demoMode} />}
      analysisPanel={analysisPanel}
      extraStats={extraStats}
      onStartTest={onStart} onStopTest={onStop} onPauseTest={onPause}
    />
  );
}
