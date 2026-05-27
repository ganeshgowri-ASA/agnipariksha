'use client';

import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

// IEC TS 63342 — LeTID Pmax-vs-hours (DEMO synth proxy of the backend logistic
// decline). Checkpoint hours overlay as markers; no IV data is involved.
const DEMO_FLOOR = -0.03;
const STEEPNESS = 8;
const PASS_RATIO = 0.95;

export function demoDegradation(tHours: number, durationH: number): number {
  if (durationH <= 0 || tHours <= 0) return 0;
  const u = Math.min(tHours / durationH, 1);
  const sig = (x: number) => 1 / (1 + Math.exp(-STEEPNESS * (x - 0.5)));
  return DEMO_FLOOR * ((sig(u) - sig(0)) / (sig(1) - sig(0)));
}

export function demoPmax(tHours: number, pmax0: number, durationH: number): number {
  return pmax0 * (1 + demoDegradation(tHours, durationH));
}

export default function PmaxCheckpointPanel({
  injectionA, tempC, durationH, checkpoints, pmaxInitial = 100,
}: { injectionA: number; tempC: number; durationH: number; checkpoints: number[]; pmaxInitial?: number }) {
  const { data, verdict, ratioPct } = useMemo(() => {
    const step = Math.max(1, durationH / 80);
    const series: { hours: number; pmax: number }[] = [];
    for (let t = 0; t <= durationH + 1e-9; t += step) {
      series.push({ hours: +t.toFixed(2), pmax: +demoPmax(t, pmaxInitial, durationH).toFixed(3) });
    }
    const ratio = demoPmax(durationH, pmaxInitial, durationH) / (pmaxInitial || 1);
    return { data: series, verdict: ratio >= PASS_RATIO ? 'PASS' : 'FAIL', ratioPct: ratio * 100 };
  }, [durationH, pmaxInitial]);

  const pass = verdict === 'PASS';
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-3" data-testid="letid-pmax-panel">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-purple-400">LeTID — Pmax vs cumulative hours</h3>
          <p className="text-[11px] text-gray-500">IEC TS 63342 · {injectionA} A · {tempC} °C · {durationH} h · DEMO synth proxy</p>
        </div>
        <span data-testid="letid-pmax-verdict" className={`px-2 py-0.5 rounded border text-[10px] font-bold ${pass ? 'bg-green-900/40 text-green-300 border-green-700/50' : 'bg-red-900/40 text-red-300 border-red-700/50'}`}>
          {verdict} · {ratioPct.toFixed(1)}%
        </span>
      </div>
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 24, bottom: 16, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis type="number" dataKey="hours" domain={[0, Math.ceil(durationH)]} tick={{ fill: '#9ca3af', fontSize: 10 }} label={{ value: 'Cumulative exposure (h)', position: 'insideBottom', offset: -8, fill: '#6b7280', fontSize: 10 }} />
            <YAxis domain={['auto', 'auto']} width={52} tick={{ fill: '#9ca3af', fontSize: 10 }} label={{ value: 'Pmax (W)', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 10 }} />
            <Tooltip contentStyle={{ background: '#0b1020', border: '1px solid #374151', fontSize: 12 }} formatter={(v: number) => [`${Number(v).toFixed(2)} W`, 'Pmax']} labelFormatter={(h: number) => `${Number(h).toFixed(1)} h`} />
            {checkpoints.map((h) => <ReferenceLine key={h} x={h} stroke="#a78bfa" strokeDasharray="2 4" strokeOpacity={0.6} />)}
            <Line type="monotone" dataKey="pmax" stroke="#a78bfa" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[10px] text-gray-500" data-testid="letid-checkpoint-list">{checkpoints.length} checkpoint markers @ {checkpoints.join(', ')} h · PASS if Pmax(end)/Pmax(0) ≥ {PASS_RATIO}</p>
    </div>
  );
}
