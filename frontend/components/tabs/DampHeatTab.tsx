'use client';

import { useState, useCallback } from 'react';
import TestTabLayout from '../TestTabLayout';
import type { TestSession, LiveReading } from '@/types/test-session';

interface DampHeatGate {
  name: string;
  clause: string;
  status: 'pass' | 'fail' | 'pending' | 'skipped';
  detail: string;
}

interface DampHeatReport {
  session_id: string;
  iec_clause: string;
  result: 'PASS' | 'FAIL' | 'PENDING';
  raw_csv_path: string | null;
  analysis: {
    samples: number;
    in_tolerance_samples: number;
    in_tolerance_fraction: number;
    in_tolerance_duration_h: number;
    total_duration_h: number;
    duration_pass: boolean;
    temp_excursions: number;
    rh_excursions: number;
    pmax_loss_pct: number | null;
    gate2: DampHeatGate;
    mqt01: DampHeatGate;
    mqt15: DampHeatGate;
    overall: string;
  };
  timeline: Array<{
    t_s: number;
    temperature_c: number;
    humidity_pct: number;
    in_tolerance: boolean;
  }>;
}

interface Props {
  readings: LiveReading[];
  session: TestSession | null;
  onSessionUpdate: (s: TestSession | null) => void;
  sendCommand: (cmd: string) => void;
  demoMode: boolean;
}

export default function DampHeatTab({ readings, session, onSessionUpdate, sendCommand, demoMode }: Props) {
  const [tempC, setTempC] = useState(85);
  const [rhPct, setRhPct] = useState(85);
  const [durationHours, setDurationHours] = useState(1000);
  const [biasVoltage, setBiasVoltage] = useState(0);
  const [prePmax, setPrePmax] = useState(380);
  const [postPmax, setPostPmax] = useState(371);
  const [report, setReport] = useState<DampHeatReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const elapsedH = session
    ? Math.max(0, (Date.now() - session.startTime) / 3_600_000)
    : 0;
  const progress = durationHours > 0 ? Math.min(100, (elapsedH / durationHours) * 100) : 0;

  const fetchReport = useCallback(async () => {
    setReportLoading(true);
    setReportError(null);
    try {
      const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      const res = await fetch(`${base}/api/tests/damp-heat/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          duration_h: durationHours,
          cadence_s: 60,
          bias_current_a: 0,
          pre_pmax_w: prePmax,
          post_pmax_w: postPmax,
          visual_defects: 0,
          insulation_mohm: 120,
          time_scale: 1_000_000,
          max_samples: Math.min(720, Math.floor((durationHours * 3600) / 60) + 1),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as DampHeatReport;
      setReport(body);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : String(err));
    } finally {
      setReportLoading(false);
    }
  }, [durationHours, prePmax, postPmax]);

  const onStart = useCallback(() => {
    const newSession: TestSession = {
      id: `DH-${Date.now()}`,
      testType: 'damp_heat',
      startTime: Date.now(),
      status: 'running',
      readings: [],
      iecClause: 'IEC 61215-2 MQT 13',
    };
    onSessionUpdate(newSession);
    sendCommand('SOUR:FUNC:MODE CV');
    sendCommand(`SOUR:VOLT ${biasVoltage}`);
    sendCommand('OUTP ON');
    sendCommand(`PROG:DH:RUN ${tempC},${rhPct},${durationHours}`);
    sendCommand('PROG:EXEC');
  }, [tempC, rhPct, durationHours, biasVoltage, onSessionUpdate, sendCommand]);

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
        <h3 className="text-sm font-bold text-cyan-400 mb-3">IEC 61215-2 MQT 13 — Damp Heat</h3>
        <p className="text-xs text-gray-400 mb-4">
          Sustained {tempC}°C / {rhPct}%RH for {durationHours} hours.
          Pmax decay vs initial baseline must stay within Gate-2 tolerance.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Temp (°C)',     value: tempC,         set: setTempC,         min: 40, max: 100, step: 1, unit: '°C' },
            { label: 'RH (%)',        value: rhPct,         set: setRhPct,         min: 40, max: 100, step: 1, unit: '%RH' },
            { label: 'Duration (hr)', value: durationHours, set: setDurationHours, min: 1,  max: 5000, step: 1, unit: 'hr' },
            { label: 'Bias (V)',      value: biasVoltage,   set: setBiasVoltage,   min: 0,  max: 1500, step: 1, unit: 'V' },
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
        <div className="mt-4 text-xs text-gray-500">
          Elapsed: <span className="font-mono text-gray-300">{elapsedH.toFixed(1)} hr</span>
          {' · '}Progress: <span className="font-mono text-cyan-400">{progress.toFixed(1)}%</span>
        </div>
      </div>

      <div
        className="bg-gray-900 rounded-lg border border-gray-700 p-4"
        data-testid="damp-heat-report-panel"
      >
        <h3 className="text-sm font-bold text-cyan-400 mb-2">Damp Heat Report</h3>
        <p className="text-xs text-gray-400 mb-3">
          Generates a structured MQT 13 report from the backend: tolerance dwell,
          Gate-2 power loss, MQT 01 / MQT 15 stubs, and raw CSV path.
        </p>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Pre-stress Pmax (W)</label>
            <input
              type="number" value={prePmax} step="0.1"
              onChange={e => setPrePmax(Number(e.target.value))}
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Post-stress Pmax (W)</label>
            <input
              type="number" value={postPmax} step="0.1"
              onChange={e => setPostPmax(Number(e.target.value))}
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={fetchReport}
          disabled={reportLoading}
          data-testid="damp-heat-generate-report"
          className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs font-medium px-3 py-1.5 rounded"
        >
          {reportLoading ? 'Running MQT 13 …' : 'Generate report'}
        </button>
        {reportError && (
          <p className="mt-2 text-xs text-red-400" data-testid="damp-heat-report-error">
            Report failed: {reportError}
          </p>
        )}
        {report && (
          <div className="mt-4 space-y-2 text-xs" data-testid="damp-heat-report-result">
            <div className="flex items-center gap-3">
              <span className="text-gray-400">Result:</span>
              <span
                className={`font-bold ${
                  report.result === 'PASS' ? 'text-green-400' :
                  report.result === 'FAIL' ? 'text-red-400' : 'text-yellow-400'
                }`}
                data-testid="damp-heat-report-result-label"
              >
                {report.result}
              </span>
              <span className="text-gray-500">· {report.iec_clause}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-gray-300">
              <div>Samples: <span className="font-mono">{report.analysis.samples}</span></div>
              <div>In tolerance: <span className="font-mono">{report.analysis.in_tolerance_samples}</span></div>
              <div>In-tol duration: <span className="font-mono">{report.analysis.in_tolerance_duration_h.toFixed(2)} h</span></div>
              <div>Total duration: <span className="font-mono">{report.analysis.total_duration_h.toFixed(2)} h</span></div>
              <div>Temp excursions: <span className="font-mono">{report.analysis.temp_excursions}</span></div>
              <div>RH excursions: <span className="font-mono">{report.analysis.rh_excursions}</span></div>
              <div>Pmax loss: <span className="font-mono">
                {report.analysis.pmax_loss_pct == null ? '—' : `${report.analysis.pmax_loss_pct.toFixed(2)} %`}
              </span></div>
              <div>CSV: <span className="font-mono break-all">{report.raw_csv_path ?? '—'}</span></div>
            </div>
            <ul className="space-y-1">
              {[report.analysis.gate2, report.analysis.mqt01, report.analysis.mqt15].map(g => (
                <li key={g.name} className="flex items-center gap-2">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      g.status === 'pass' ? 'bg-green-400' :
                      g.status === 'fail' ? 'bg-red-400' :
                      g.status === 'pending' ? 'bg-yellow-400' : 'bg-gray-500'
                    }`}
                  />
                  <span className="text-gray-300">{g.name}</span>
                  <span className="text-gray-500">— {g.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <TestTabLayout
      testKey="dh" testName="Damp Heat" standard="IEC 61215-2 MQT 13"
      color="text-cyan-400" readings={readings} session={session}
      onSessionUpdate={onSessionUpdate} sendCommand={sendCommand} demoMode={demoMode}
      limits={{ maxVoltage: 1500, maxCurrent: 20, maxPower: 6000, maxTemp: 100 }}
      setupPanel={setupPanel} extraStats={[
        { label: 'Temp', value: tempC.toString(), unit: '°C', color: 'text-orange-400' },
        { label: 'RH', value: rhPct.toString(), unit: '%', color: 'text-cyan-400' },
        { label: 'Elapsed', value: elapsedH.toFixed(1), unit: 'hr', color: 'text-blue-400' },
        { label: 'Progress', value: progress.toFixed(1), unit: '%', color: 'text-green-400' },
      ]}
      onStartTest={onStart} onStopTest={onStop} onPauseTest={onPause}
    />
  );
}
