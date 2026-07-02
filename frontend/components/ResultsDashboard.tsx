'use client';

import { useMemo } from 'react';
import type { TestSession } from '@/types/test-session';

interface Props {
  sessions: Record<string, TestSession | null>;
}

const TEST_LABELS: Record<string, { name: string; std: string; color: string }> = {
  tc:    { name: 'Thermal Cycling',       std: 'IEC 61215 MQT11', color: 'border-orange-500' },
  hf:    { name: 'Humidity Freeze',        std: 'IEC 61215 MQT12', color: 'border-blue-500' },
  letid: { name: 'LeTID',                  std: 'IEC TS 63342',    color: 'border-purple-500' },
  bdt:   { name: 'Bypass Diode Thermal',   std: 'IEC 62979',       color: 'border-yellow-500' },
  rco:   { name: 'Reverse Current Overload', std: 'IEC 61730-2:2023 MST 26', color: 'border-red-500' },
  gct:   { name: 'Ground Continuity',      std: 'IEC 61730-2:2023 MST 13', color: 'border-green-500' },
  dh:    { name: 'Damp Heat',              std: 'IEC 61215-2 MQT 13', color: 'border-cyan-500' },
};

export default function ResultsDashboard({ sessions }: Props) {
  const stats = useMemo(() => {
    const all = Object.values(sessions).filter(Boolean) as TestSession[];
    return {
      total: all.length,
      pass: all.filter(s => s.result === 'PASS').length,
      fail: all.filter(s => s.result === 'FAIL').length,
      running: all.filter(s => s.status === 'running').length,
    };
  }, [sessions]);

  const exportAllCSV = () => {
    const lines: string[] = ['TestType,SessionID,StartTime,EndTime,Result,Readings,AvgVoltage,AvgCurrent'];
    Object.entries(sessions).forEach(([key, s]) => {
      if (!s) return;
      const avgV = s.readings.length ? (s.readings.reduce((a,r) => a+r.voltage,0)/s.readings.length).toFixed(4) : '';
      const avgI = s.readings.length ? (s.readings.reduce((a,r) => a+r.current,0)/s.readings.length).toFixed(4) : '';
      lines.push(`${TEST_LABELS[key]?.name},${s.id},${new Date(s.startTime).toISOString()},${s.endTime ? new Date(s.endTime).toISOString() : ''},${s.result||''},${s.readings.length},${avgV},${avgI}`);
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `Agnipariksha_Results_${Date.now()}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Tests Initiated', value: stats.total, color: 'text-white', bg: 'bg-gray-800' },
          { label: 'Passed', value: stats.pass, color: 'text-green-400', bg: 'bg-green-900/30' },
          { label: 'Failed', value: stats.fail, color: 'text-red-400', bg: 'bg-red-900/30' },
          { label: 'Running', value: stats.running, color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
        ].map(c => (
          <div key={c.label} className={`${c.bg} rounded-xl border border-gray-700 p-4 text-center`}>
            <p className="text-xs text-gray-400 mb-1">{c.label}</p>
            <p className={`text-3xl font-bold font-mono ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Test Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Object.entries(TEST_LABELS).map(([key, meta]) => {
          const s = sessions[key];
          const avgV = s?.readings.length ? (s.readings.reduce((a,r) => a+r.voltage,0)/s.readings.length).toFixed(3) : '—';
          const avgI = s?.readings.length ? (s.readings.reduce((a,r) => a+r.current,0)/s.readings.length).toFixed(3) : '—';
          const dur = s ? (((s.endTime || Date.now()) - s.startTime) / 60000).toFixed(1) : '—';

          return (
            <div key={key} className={`bg-gray-900 rounded-xl border-l-4 ${meta.color} border-t border-r border-b border-gray-700 p-4`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-white">{meta.name}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                  s?.result === 'PASS' ? 'bg-green-800 text-green-300' :
                  s?.result === 'FAIL' ? 'bg-red-800 text-red-300' :
                  s?.status === 'running' ? 'bg-yellow-800 text-yellow-300' :
                  'bg-gray-700 text-gray-400'
                }`}>
                  {s?.result || s?.status?.toUpperCase() || 'NOT STARTED'}
                </span>
              </div>
              <p className="text-xs text-gray-500 mb-3">{meta.std}</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><p className="text-xs text-gray-500">Avg V</p><p className="text-sm font-mono text-blue-300">{avgV}</p></div>
                <div><p className="text-xs text-gray-500">Avg A</p><p className="text-sm font-mono text-green-300">{avgI}</p></div>
                <div><p className="text-xs text-gray-500">Duration</p><p className="text-sm font-mono text-yellow-300">{dur} min</p></div>
              </div>
              {s && (
                <div className="mt-2 text-xs text-gray-500">
                  {s.readings.length.toLocaleString()} measurements recorded
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button onClick={exportAllCSV}
          className="px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white text-sm rounded font-medium transition-colors">
          ↓ Export All Results CSV
        </button>
      </div>
    </div>
  );
}
