'use client';

import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { TestSession } from '@/app/page';

interface Props {
  sessions: Record<string, TestSession | null>;
}

type TestMeta = {
  name: string;
  short: string;
  std: string;
  color: string;
  stroke: string;
  iec: string;
  limit: string;
};

const TEST_LABELS: Record<string, TestMeta> = {
  tc:    { name: 'Thermal Cycling',          short: 'TC',  std: 'IEC 61215 MQT11', color: 'border-orange-500', stroke: '#f97316', iec: 'IEC 61215 MQT11', limit: '200 cycles, -40 to +85°C' },
  hf:    { name: 'Humidity Freeze',          short: 'HF',  std: 'IEC 61215 MQT12', color: 'border-blue-500',   stroke: '#3b82f6', iec: 'IEC 61215 MQT12', limit: '85%RH, +85 to -40°C, 10 cycles' },
  letid: { name: 'LeTID',                    short: 'LID', std: 'IEC TS 63342',    color: 'border-purple-500', stroke: '#a855f7', iec: 'IEC TS 63342',    limit: 'Idark = Isc-Imp @ 75°C, 162h' },
  bdt:   { name: 'Bypass Diode Thermal',     short: 'BDT', std: 'IEC 62979',       color: 'border-yellow-500', stroke: '#eab308', iec: 'IEC 62979',       limit: '1.35×Isc @ 1h' },
  rco:   { name: 'Reverse Current Overload', short: 'RCO', std: 'IEC 61730 MST26', color: 'border-red-500',    stroke: '#ef4444', iec: 'IEC 61730 MST26', limit: '135% fuse rating' },
  gct:   { name: 'Ground Continuity',        short: 'GCT', std: 'IEC 61730 MST13', color: 'border-green-500',  stroke: '#22c55e', iec: 'IEC 61730 MST13', limit: '25A, R < 0.1Ω' },
};

function avg(arr: number[]): number | null {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function fmt(v: number | null, digits = 3): string {
  return v === null || isNaN(v) ? '—' : v.toFixed(digits);
}

export default function ResultsDashboard({ sessions }: Props) {
  const stats = useMemo(() => {
    const all = Object.values(sessions).filter(Boolean) as TestSession[];
    const pass = all.filter(s => s.result === 'PASS').length;
    const fail = all.filter(s => s.result === 'FAIL').length;
    const decided = pass + fail;
    return {
      total: all.length,
      pass,
      fail,
      running: all.filter(s => s.status === 'running').length,
      overall: decided === 0 ? 'PENDING' : fail === 0 ? 'PASS' : 'FAIL',
      passRate: decided ? Math.round((pass / decided) * 100) : 0,
    };
  }, [sessions]);

  const exportAllCSV = () => {
    const lines: string[] = [
      'TestType,Standard,SessionID,StartTime,EndTime,DurationMin,Result,Status,Readings,AvgVoltage,AvgCurrent,AvgPower,MinV,MaxV,MinI,MaxI',
    ];
    Object.entries(sessions).forEach(([key, s]) => {
      if (!s) return;
      const meta = TEST_LABELS[key];
      const vs = s.readings.map(r => r.voltage);
      const is = s.readings.map(r => r.current);
      const ps = s.readings.map(r => r.power);
      const dur = ((s.endTime || Date.now()) - s.startTime) / 60000;
      lines.push([
        meta?.name ?? key,
        meta?.std ?? '',
        s.id,
        new Date(s.startTime).toISOString(),
        s.endTime ? new Date(s.endTime).toISOString() : '',
        dur.toFixed(2),
        s.result ?? '',
        s.status,
        s.readings.length,
        fmt(avg(vs), 4),
        fmt(avg(is), 4),
        fmt(avg(ps), 4),
        vs.length ? Math.min(...vs).toFixed(4) : '',
        vs.length ? Math.max(...vs).toFixed(4) : '',
        is.length ? Math.min(...is).toFixed(4) : '',
        is.length ? Math.max(...is).toFixed(4) : '',
      ].join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Agnipariksha_Results_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const overallColor =
    stats.overall === 'PASS' ? 'text-green-400 bg-green-900/30 border-green-700' :
    stats.overall === 'FAIL' ? 'text-red-400 bg-red-900/30 border-red-700' :
                               'text-gray-300 bg-gray-800 border-gray-700';

  return (
    <div className="p-6 space-y-6">
      {/* Header + Overall Verdict */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">Cross-Test Results Dashboard</h2>
          <p className="text-xs text-gray-400 mt-1">Summary of all six IEC reliability tests on this module.</p>
        </div>
        <div className={`px-4 py-2 rounded-xl border-2 ${overallColor}`}>
          <p className="text-[10px] uppercase tracking-wider opacity-70">Overall Verdict</p>
          <p className="text-2xl font-bold font-mono">{stats.overall}</p>
          <p className="text-[10px] opacity-70 mt-0.5">{stats.passRate}% pass rate ({stats.pass}/{stats.pass + stats.fail})</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Tests Initiated', value: stats.total, color: 'text-white', bg: 'bg-gray-800' },
          { label: 'Passed',          value: stats.pass,  color: 'text-green-400',  bg: 'bg-green-900/30' },
          { label: 'Failed',          value: stats.fail,  color: 'text-red-400',    bg: 'bg-red-900/30' },
          { label: 'Running',         value: stats.running, color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
        ].map(c => (
          <div key={c.label} className={`${c.bg} rounded-xl border border-gray-700 p-4 text-center`}>
            <p className="text-xs text-gray-400 mb-1">{c.label}</p>
            <p className={`text-3xl font-bold font-mono ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* IEC Compliance Checklist */}
      <div className="bg-gray-900 rounded-xl border border-gray-700 p-4">
        <h3 className="text-sm font-bold text-white mb-3">IEC Compliance Checklist</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {Object.entries(TEST_LABELS).map(([key, meta]) => {
            const s = sessions[key];
            const icon =
              s?.result === 'PASS' ? '✅' :
              s?.result === 'FAIL' ? '❌' :
              s?.status === 'running' ? '⏳' :
                                       '◻️';
            const text =
              s?.result === 'PASS' ? 'text-green-300' :
              s?.result === 'FAIL' ? 'text-red-300' :
              s?.status === 'running' ? 'text-yellow-300' :
                                       'text-gray-500';
            return (
              <div key={key} className="flex items-start gap-3 py-1 text-xs">
                <span className="text-base leading-none">{icon}</span>
                <div className="flex-1 min-w-0">
                  <span className={`font-medium ${text}`}>{meta.iec}</span>
                  <span className="text-gray-400"> — {meta.name}</span>
                  <p className="text-gray-500 text-[10px] truncate">Limit: {meta.limit}</p>
                </div>
                <span className={`font-mono ${text}`}>
                  {s?.result || s?.status?.toUpperCase() || 'NOT RUN'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Test Cards with last-run chart */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Object.entries(TEST_LABELS).map(([key, meta]) => {
          const s = sessions[key];
          const avgV = avg(s?.readings.map(r => r.voltage) ?? []);
          const avgI = avg(s?.readings.map(r => r.current) ?? []);
          const dur = s ? (((s.endTime || Date.now()) - s.startTime) / 60000) : null;
          const chartData = (s?.readings ?? []).slice(-120).map(r => ({
            t: r.timestamp,
            v: r.voltage,
          }));

          const statusBadge =
            s?.result === 'PASS' ? 'bg-green-800 text-green-300' :
            s?.result === 'FAIL' ? 'bg-red-800 text-red-300' :
            s?.status === 'running' ? 'bg-yellow-800 text-yellow-300' :
                                     'bg-gray-700 text-gray-400';

          return (
            <div key={key} className={`bg-gray-900 rounded-xl border-l-4 ${meta.color} border-t border-r border-b border-gray-700 p-4 flex flex-col`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold text-white">{meta.name}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${statusBadge}`}>
                  {s?.result || s?.status?.toUpperCase() || 'NOT STARTED'}
                </span>
              </div>
              <p className="text-xs text-gray-500 mb-3">{meta.std}</p>

              <div className="grid grid-cols-3 gap-2 text-center mb-2">
                <div><p className="text-xs text-gray-500">Avg V</p><p className="text-sm font-mono text-blue-300">{fmt(avgV)}</p></div>
                <div><p className="text-xs text-gray-500">Avg A</p><p className="text-sm font-mono text-green-300">{fmt(avgI)}</p></div>
                <div><p className="text-xs text-gray-500">Duration</p><p className="text-sm font-mono text-yellow-300">{dur === null ? '—' : `${dur.toFixed(1)} min`}</p></div>
              </div>

              <div className="h-[100px] -mx-1">
                {chartData.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="t" hide />
                      <YAxis hide domain={['auto', 'auto']} />
                      <Tooltip
                        contentStyle={{ background: '#1f2937', border: '1px solid #374151', fontSize: 10 }}
                        labelFormatter={(v) => new Date(v as number).toLocaleTimeString()}
                        formatter={(v: number) => [v.toFixed(3) + ' V', 'Voltage']}
                      />
                      <Line type="monotone" dataKey="v" stroke={meta.stroke} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-gray-600 border border-dashed border-gray-700 rounded">
                    No run data yet
                  </div>
                )}
              </div>

              {s && (
                <p className="text-[10px] text-gray-500 mt-2">
                  {s.readings.length.toLocaleString()} measurements · last run {new Date(s.startTime).toLocaleString()}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button
          onClick={exportAllCSV}
          className="px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white text-sm rounded font-medium transition-colors"
        >
          ↓ Export All Results CSV
        </button>
      </div>
    </div>
  );
}
