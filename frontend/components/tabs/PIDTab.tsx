'use client';

import { useCallback, useMemo, useState } from 'react';
import { Play, Square, Settings, Activity, Table2, BarChart3, FileText } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import LiveChart from '../LiveChart';
import DataTable from '../DataTable';
import type { TestSession, LiveReading } from '@/types/test-session';

interface Props {
  readings: LiveReading[];
  session: TestSession | null;
  onSessionUpdate: (s: TestSession | null) => void;
  sendCommand: (cmd: string) => void;
  demoMode: boolean;
}

interface PmaxPoint {
  hour: number;
  pmax: number;
}

type SubTab = 'setup' | 'monitor' | 'data' | 'analysis' | 'report';
const SUB_TABS: Array<{ key: SubTab; label: string; icon: typeof Settings }> = [
  { key: 'setup',    label: 'Setup',        icon: Settings },
  { key: 'monitor',  label: 'Live Monitor', icon: Activity },
  { key: 'data',     label: 'Data Table',   icon: Table2 },
  { key: 'analysis', label: 'Analysis',     icon: BarChart3 },
  { key: 'report',   label: 'Report',       icon: FileText },
];

const PASS_THRESHOLD = 95; // % retention, IEC TS 62804-1

// DEMO seed — modest degradation that finishes just above the pass line.
const DEMO_BASELINE = 300;
const DEMO_POINTS: PmaxPoint[] = [0, 24, 48, 72, 96].map((hour, i) => ({
  hour,
  pmax: +(DEMO_BASELINE * (1 - i * 0.009)).toFixed(2),
}));

export default function PIDTab({ readings, session, onSessionUpdate, sendCommand, demoMode }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('setup');
  const [stressVoltage, setStressVoltage] = useState(1500); // module system voltage fallback
  const [polarity, setPolarity] = useState<'+' | '-'>('-');
  const [duration, setDuration] = useState(96);     // hours
  const [chamberTemp, setChamberTemp] = useState(85); // °C
  const [chamberRH, setChamberRH] = useState(85);    // %
  const [pmaxBaseline, setPmaxBaseline] = useState(demoMode ? DEMO_BASELINE : 0);
  const [points, setPoints] = useState<PmaxPoint[]>(demoMode ? DEMO_POINTS : []);
  const [newHour, setNewHour] = useState('');
  const [newPmax, setNewPmax] = useState('');

  // Retention curve: (Pmax_now / Pmax_baseline) * 100, ordered by hour.
  const retention = useMemo(() => {
    if (pmaxBaseline <= 0) return [];
    return [...points]
      .sort((a, b) => a.hour - b.hour)
      .map(p => ({ hour: p.hour, retention: +((p.pmax / pmaxBaseline) * 100).toFixed(2) }));
  }, [points, pmaxBaseline]);

  const finalRetention = retention.length ? retention[retention.length - 1].retention : null;
  const verdict: 'PASS' | 'FAIL' | null =
    finalRetention === null ? null : finalRetention >= PASS_THRESHOLD ? 'PASS' : 'FAIL';

  // RH is not part of the live stream — synthesise it around the setpoint.
  const rhReadings = useMemo<LiveReading[]>(
    () => readings.map((r, i) => ({ ...r, humidity: +(chamberRH + Math.sin(i / 5) * 1.5).toFixed(2) })),
    [readings, chamberRH],
  );

  const addPoint = useCallback(() => {
    const h = parseFloat(newHour);
    const p = parseFloat(newPmax);
    if (isNaN(h) || isNaN(p)) return;
    setPoints(prev => [...prev, { hour: h, pmax: p }]);
    setNewHour('');
    setNewPmax('');
  }, [newHour, newPmax]);

  const onStart = useCallback(() => {
    onSessionUpdate({
      id: `PID-${Date.now()}`, testType: 'pid',
      startTime: Date.now(), status: 'running', readings: [],
    });
    sendCommand(`SOUR:VOLT ${polarity === '-' ? '-' : ''}${stressVoltage}`);
    sendCommand(`SOUR:TEMP ${chamberTemp}`);
    sendCommand('OUTP ON');
    sendCommand(`PROG:PID ${stressVoltage},${polarity},${duration},${chamberTemp},${chamberRH}`);
    sendCommand('PROG:EXEC');
  }, [stressVoltage, polarity, duration, chamberTemp, chamberRH, onSessionUpdate, sendCommand]);

  const onStop = useCallback(() => {
    if (!session) return;
    sendCommand('OUTP OFF');
    const result: 'PASS' | 'FAIL' = verdict ?? 'PASS';
    onSessionUpdate({
      ...session, status: result === 'PASS' ? 'pass' : 'fail',
      endTime: Date.now(), result,
    });
  }, [session, verdict, onSessionUpdate, sendCommand]);

  const isRunning = session?.status === 'running';
  const latest = readings[readings.length - 1];

  const verdictPill = verdict && (
    <span className={`px-2 py-0.5 rounded text-xs font-bold ${
      verdict === 'PASS' ? 'bg-green-900/40 text-green-300 border border-green-700/50'
                         : 'bg-red-900/40 text-red-300 border border-red-700/50'
    }`} data-testid="pid-verdict">{verdict}</span>
  );

  const numberField = (
    label: string, value: number, set: (n: number) => void,
    min: number, max: number, step: number, unit: string,
  ) => (
    <div>
      <label className="text-xs text-gray-400 block mb-1">{label}</label>
      <div className="flex gap-2 items-center">
        <input type="number" value={value} min={min} max={max} step={step}
          onChange={e => set(Number(e.target.value))}
          className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200" />
        <span className="text-xs text-gray-500 w-10">{unit}</span>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-gray-950" data-testid="test-tab-pid">
      {/* Header + controls */}
      <div className="bg-gray-900 border-b border-gray-700 px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-bold text-pink-400">Potential-Induced Degradation</span>
          <span className="text-[10px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded">IEC TS 62804-1</span>
          {session && <span className="text-xs font-medium text-gray-300">● {session.status.toUpperCase()}</span>}
          {verdictPill}
          {demoMode && <span className="text-[10px] text-yellow-400 bg-yellow-900/30 px-1.5 py-0.5 rounded">DEMO</span>}
        </div>
        <div className="flex gap-1.5">
          <button type="button" onClick={onStart} disabled={isRunning}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-white text-xs rounded font-semibold bg-green-700 hover:bg-green-600 disabled:opacity-40">
            <Play className="w-3.5 h-3.5" /> Start
          </button>
          <button type="button" onClick={onStop} disabled={!session || session.status === 'idle'}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-white text-xs rounded font-semibold bg-red-700 hover:bg-red-600 disabled:opacity-40">
            <Square className="w-3.5 h-3.5" /> Stop
          </button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex border-b border-gray-800 bg-gray-900 overflow-x-auto" role="tablist" data-testid="subtab-list">
        {SUB_TABS.map(({ key, label, icon: Icon }) => {
          const active = subTab === key;
          return (
            <button key={key} type="button" onClick={() => setSubTab(key)}
              role="tab" aria-selected={active}
              data-testid={`subtab-${key}`} data-state={active ? 'active' : 'inactive'}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors border-b-2 ${
                active ? 'border-pink-400 text-white bg-gray-800/50' : 'border-transparent text-gray-500 hover:text-gray-200'
              }`}>
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {subTab === 'setup' && (
          <div className="max-w-2xl space-y-4" data-testid="subtab-pane-setup">
            <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
              <h3 className="text-sm font-bold text-pink-400 mb-3">IEC TS 62804-1 — PID Stress Setup</h3>
              <p className="text-xs text-gray-400 mb-4">
                Constant DC bias between module circuit and frame at elevated T/RH.
                Record the pre-stress Pmax baseline before energising.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {numberField('Stress Voltage (V)', stressVoltage, setStressVoltage, 0, 2000, 50, 'V')}
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Polarity</label>
                  <div className="flex gap-1">
                    {(['+', '-'] as const).map(p => (
                      <button key={p} type="button" onClick={() => setPolarity(p)}
                        data-testid={`pid-polarity-${p === '+' ? 'pos' : 'neg'}`}
                        className={`flex-1 px-2 py-1.5 text-xs rounded border ${
                          polarity === p ? 'bg-pink-900/40 border-pink-600 text-pink-200'
                                         : 'bg-gray-800 border-gray-600 text-gray-400'
                        }`}>{p === '+' ? '+ (positive)' : '− (negative)'}</button>
                    ))}
                  </div>
                </div>
                {numberField('Duration (hr)', duration, setDuration, 1, 1000, 1, 'hr')}
                {numberField('Chamber Temp (°C)', chamberTemp, setChamberTemp, 25, 100, 1, '°C')}
                {numberField('Chamber RH (%)', chamberRH, setChamberRH, 0, 100, 1, '%')}
                {numberField('Pmax Baseline (W)', pmaxBaseline, setPmaxBaseline, 0, 1000, 0.1, 'W')}
              </div>
            </div>
          </div>
        )}

        {subTab === 'monitor' && (
          <div className="space-y-4" data-testid="subtab-pane-monitor">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Bias Voltage', value: `${polarity}${stressVoltage}`, unit: 'V', color: 'text-blue-400' },
                { label: 'Chamber T', value: (latest?.temperature ?? chamberTemp).toFixed(1), unit: '°C', color: 'text-red-400' },
                { label: 'Chamber RH', value: chamberRH.toString(), unit: '%', color: 'text-cyan-400' },
                { label: 'Retention', value: finalRetention?.toFixed(2) ?? '—', unit: '%', color: 'text-pink-400' },
              ].map(s => (
                <div key={s.label} className="bg-gray-900 rounded-lg p-3 border border-gray-700">
                  <p className="text-xs text-gray-500">{s.label}</p>
                  <p className={`text-xl font-mono font-bold ${s.color}`}>
                    {s.value} <span className="text-xs font-normal text-gray-400">{s.unit}</span>
                  </p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <LiveChart readings={readings} metric="voltage" color="#60a5fa" label="Voltage (V)" />
              <LiveChart readings={readings} metric="current" color="#34d399" label="Current (A)" />
              <LiveChart readings={readings} metric="temperature" color="#f87171" label="Temperature (°C)" />
              <LiveChart readings={rhReadings} metric="humidity" color="#22d3ee" label="Humidity (%)" />
            </div>
            <PmaxTable
              points={points} baseline={pmaxBaseline}
              newHour={newHour} newPmax={newPmax}
              setNewHour={setNewHour} setNewPmax={setNewPmax} addPoint={addPoint}
            />
          </div>
        )}

        {subTab === 'data' && (
          <div data-testid="subtab-pane-data">
            <DataTable readings={(session?.readings.length ? session.readings : readings)} testName="PID" />
          </div>
        )}

        {subTab === 'analysis' && (
          <div className="space-y-4 max-w-3xl" data-testid="subtab-pane-analysis">
            <RetentionChart data={retention} />
            <div className="bg-gray-900 rounded-lg border border-gray-700 p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">Final Pmax Retention</p>
                <p className="text-2xl font-mono font-bold text-pink-400">
                  {finalRetention?.toFixed(2) ?? '—'} <span className="text-sm text-gray-400">%</span>
                </p>
                <p className="text-xs text-gray-500 mt-1">Pass threshold ≥ {PASS_THRESHOLD}%</p>
              </div>
              {verdict
                ? verdictPill
                : <span className="text-xs text-gray-500">Enter Pmax points to evaluate</span>}
            </div>
          </div>
        )}

        {subTab === 'report' && (
          <div className="space-y-4 max-w-3xl" data-testid="subtab-pane-report">
            <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
              <h3 className="text-sm font-bold text-pink-400 mb-1">PID Test Report</h3>
              <p className="text-xs text-gray-400">IEC TS 62804-1 · {stressVoltage} V {polarity} · {duration} h · {chamberTemp} °C / {chamberRH}% RH</p>
            </div>
            <RetentionChart data={retention} />
            <div className="bg-gray-900 rounded-lg border border-gray-700 p-4 flex items-center justify-between">
              <p className="text-sm text-gray-300">
                Final retention <strong className="text-pink-400">{finalRetention?.toFixed(2) ?? '—'}%</strong>
                {' '}(baseline {pmaxBaseline} W)
              </p>
              {verdictPill ?? <span className="text-xs text-gray-500">incomplete</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PmaxTable({
  points, baseline, newHour, newPmax, setNewHour, setNewPmax, addPoint,
}: {
  points: PmaxPoint[]; baseline: number;
  newHour: string; newPmax: string;
  setNewHour: (s: string) => void; setNewPmax: (s: string) => void; addPoint: () => void;
}) {
  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700" data-testid="pid-pmax-table">
      <div className="px-3 py-2 border-b border-gray-700 text-sm font-medium text-gray-300">
        Periodic Pmax Measurements
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-400 border-b border-gray-700">
            <th className="px-3 py-2 text-left font-medium">Hour</th>
            <th className="px-3 py-2 text-right font-medium">Pmax (W)</th>
            <th className="px-3 py-2 text-right font-medium">Retention (%)</th>
          </tr>
        </thead>
        <tbody>
          {points.length === 0 && (
            <tr><td colSpan={3} className="px-3 py-3 text-center text-gray-500">No measurements yet</td></tr>
          )}
          {[...points].sort((a, b) => a.hour - b.hour).map(p => (
            <tr key={`${p.hour}-${p.pmax}`} className="border-b border-gray-800">
              <td className="px-3 py-1.5 text-gray-300 font-mono">{p.hour}</td>
              <td className="px-3 py-1.5 text-right text-yellow-300 font-mono">{p.pmax.toFixed(2)}</td>
              <td className="px-3 py-1.5 text-right text-pink-300 font-mono">
                {baseline > 0 ? ((p.pmax / baseline) * 100).toFixed(2) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2 p-3 border-t border-gray-700">
        <input type="number" value={newHour} onChange={e => setNewHour(e.target.value)} placeholder="Hour"
          data-testid="pid-new-hour"
          className="w-24 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200" />
        <input type="number" value={newPmax} onChange={e => setNewPmax(e.target.value)} placeholder="Pmax (W)"
          data-testid="pid-new-pmax"
          className="w-28 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200" />
        <button type="button" onClick={addPoint} data-testid="pid-add-point"
          className="px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded">Add</button>
      </div>
    </div>
  );
}

function RetentionChart({ data }: { data: Array<{ hour: number; retention: number }> }) {
  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 p-3" data-testid="pid-retention-chart">
      <span className="text-xs font-medium text-gray-300">Pmax Retention vs Time</span>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#6b7280' }}
            label={{ value: 'Hours', fontSize: 10, fill: '#6b7280', position: 'insideBottom', offset: -2 }} />
          <YAxis domain={[90, 101]} tick={{ fontSize: 10, fill: '#6b7280' }} width={40}
            tickFormatter={v => `${v}%`} />
          <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #4b5563', fontSize: 11 }} />
          <ReferenceLine y={95} stroke="#ef4444" strokeDasharray="4 4"
            label={{ value: '95% pass', fontSize: 9, fill: '#ef4444' }} />
          <Line type="monotone" dataKey="retention" stroke="#ec4899" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
