'use client';

import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { GATE2_PMAX_DELTA_PERCENT, type TestSession } from '@/types/test-session';
import AskAIButton from './AskAIButton';

interface AnalysisPanelProps {
  session: TestSession | null;
  testName: string;
  standard: string;
}

export default function AnalysisPanel({ session, testName, standard }: AnalysisPanelProps) {
  const stats = useMemo(() => {
    if (!session || session.readings.length === 0) {
      return { pre: null, post: null, delta: null, pass: null, peakP: null, avgP: null };
    }
    const ps = session.readings.map(r => r.power);
    const pre  = session.preMaxPower  ?? ps[0];
    const post = session.postMaxPower ?? ps[ps.length - 1];
    const delta = pre > 0 ? ((post - pre) / pre) * 100 : 0;
    const pass = delta >= GATE2_PMAX_DELTA_PERCENT;
    const peakP = Math.max(...ps);
    const avgP = ps.reduce((a, b) => a + b, 0) / ps.length;
    return { pre, post, delta, pass, peakP, avgP };
  }, [session]);

  const chartData = useMemo(() => {
    if (!session) return [];
    const t0 = session.startTime;
    return session.readings.map(r => ({
      tMin: ((r.timestamp - t0) / 60_000),
      power: r.power,
      voltage: r.voltage,
      current: r.current,
    }));
  }, [session]);

  if (!session) {
    return (
      <div className="text-xs text-gray-500 text-center py-12">
        No session yet — start a test to see analysis.
      </div>
    );
  }

  const summaryLine = stats.delta == null
    ? `${testName}: insufficient data for Pmax delta computation.`
    : `${testName} (${standard}): ΔPmax = ${stats.delta.toFixed(2)}% vs Gate-2 threshold of ${GATE2_PMAX_DELTA_PERCENT}%. ` +
      `Verdict: ${stats.pass ? 'PASS' : 'FAIL'}.`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Pre Pmax"  value={stats.pre  != null ? stats.pre.toFixed(3)  : '—'} unit="W" />
        <Stat label="Post Pmax" value={stats.post != null ? stats.post.toFixed(3) : '—'} unit="W" />
        <Stat
          label="ΔPmax"
          value={stats.delta != null ? stats.delta.toFixed(2) : '—'}
          unit="%"
          color={
            stats.delta == null ? 'text-gray-300'
              : stats.pass ? 'text-green-400' : 'text-red-400'
          }
        />
        <Stat
          label="Verdict"
          value={stats.pass == null ? '—' : stats.pass ? 'PASS' : 'FAIL'}
          unit=""
          color={stats.pass ? 'text-green-400' : stats.pass === false ? 'text-red-400' : 'text-gray-300'}
        />
      </div>

      <div className="bg-gray-900 border border-gray-700 rounded-lg p-3">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-xs font-semibold text-gray-300">Power trend (W vs minutes)</h3>
          <span className="text-[10px] text-gray-500">
            Gate-2 threshold: {GATE2_PMAX_DELTA_PERCENT}% ΔPmax
          </span>
        </div>
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 5, right: 12, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="tMin" tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#0b1020', border: '1px solid #374151', fontSize: 12 }} />
              <Line type="monotone" dataKey="power" stroke="#f59e0b" dot={false} strokeWidth={1.5} isAnimationActive={false} />
              {stats.pre != null && (
                <ReferenceLine
                  y={stats.pre * (1 + GATE2_PMAX_DELTA_PERCENT / 100)}
                  stroke="#ef4444" strokeDasharray="4 4"
                  label={{ value: 'Gate-2 floor', fill: '#ef4444', fontSize: 10, position: 'right' }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-700 rounded-lg p-3">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-xs font-semibold text-gray-300">AI summary</h3>
          <div className="flex flex-wrap gap-1">
            <AskAIButton
              prompt={`Explain how ΔPmax was computed for the active ${testName} run and call out which IEC clause governs the threshold.`}
              label="Explain ΔPmax"
            />
            <AskAIButton
              prompt={`Why did this ${testName} run end with the verdict ${stats.pass == null ? 'INDETERMINATE' : stats.pass ? 'PASS' : 'FAIL'}? Reference the Gate-2 floor.`}
              label="Why this verdict?"
            />
            {testName.toLowerCase().includes('diode') && (
              <AskAIButton
                prompt="Explain the Tj calculation for this bypass-diode run, including the Vf slope (-2 mV/°C) and the datasheet limit."
                label="Explain Tj"
              />
            )}
          </div>
        </div>
        <p className="text-xs text-gray-300 font-mono leading-relaxed">{summaryLine}</p>
        <p className="text-[10px] text-gray-500 mt-1">
          Auto-generated draft. Open the AI side panel for a tool-grounded, IEC-cited write-up.
        </p>
      </div>
    </div>
  );
}

function Stat({
  label, value, unit, color = 'text-white',
}: { label: string; value: string; unit: string; color?: string }) {
  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-mono font-bold ${color}`}>
        {value} <span className="text-xs font-normal text-gray-400">{unit}</span>
      </p>
    </div>
  );
}
