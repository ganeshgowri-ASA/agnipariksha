/**
 * RCO Analysis pane — IEC 61730-2 MST 26.
 *
 * Same visual language as TcAnalysisPanel / HfAnalysisPanel.
 */
'use client';

import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ReferenceArea,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import type { LiveReading } from '@/types/test-session';
import {
  computeRcoKpis, RCO_CONSTANTS, type Verdict, type RcoConfig, type RcoKpis,
} from './rcoAnalysis';

interface Props {
  readings: LiveReading[];
  config: RcoConfig;
}

function verdictColors(v: Verdict): { bg: string; ring: string; text: string } {
  switch (v) {
    case 'pass':    return { bg: 'bg-green-900/30', ring: 'ring-green-500/40', text: 'text-green-300' };
    case 'warn':    return { bg: 'bg-amber-900/30', ring: 'ring-amber-500/40', text: 'text-amber-300' };
    case 'fail':    return { bg: 'bg-red-900/30',   ring: 'ring-red-500/40',   text: 'text-red-300'   };
    case 'pending': return { bg: 'bg-gray-800',     ring: 'ring-gray-600/40',  text: 'text-gray-400'  };
  }
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-2xl font-bold text-gray-100 mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function VerdictTriple({ kpis, voltageLimit }: { kpis: RcoKpis; voltageLimit: number }) {
  const items: Array<{ label: string; v: Verdict; sub: string }> = [
    {
      label: 'Current envelope',
      v: kpis.currentEnvelopeVerdict,
      sub: `worst Δ ${kpis.worstCurrentDevA.toFixed(2)} A · tol ±${RCO_CONSTANTS.CURRENT_TOL_PCT}%`,
    },
    {
      label: 'Voltage drop',
      v: kpis.voltageDropVerdict,
      sub: kpis.voltageDropV === null ? 'awaiting telemetry' : `${kpis.voltageDropV.toFixed(2)} V / ≤${voltageLimit.toFixed(2)} V`,
    },
    {
      label: 'Backsheet T',
      v: kpis.temperatureVerdict,
      sub: `worst ${kpis.worstTempC.toFixed(1)} °C / ≤${RCO_CONSTANTS.T_MAX_C} °C`,
    },
  ];
  return (
    <div className="grid grid-cols-3 gap-3">
      {items.map((it) => {
        const c = verdictColors(it.v);
        return (
          <div key={it.label} className={`rounded-lg ${c.bg} ring-1 ${c.ring} px-3 py-2`}>
            <div className={`text-xs font-medium ${c.text}`}>{it.label}</div>
            <div className={`text-[11px] mt-0.5 ${c.text} opacity-80 tabular-nums`}>{it.sub}</div>
            <div className={`text-[10px] mt-1 uppercase font-bold ${c.text}`}>{it.v}</div>
          </div>
        );
      })}
    </div>
  );
}

function OverallPill({ kpis }: { kpis: RcoKpis }) {
  const c = verdictColors(kpis.overallVerdict);
  const label =
    kpis.overallVerdict === 'pending' ? `In progress — phase ${kpis.phase}`
    : kpis.overallVerdict === 'pass'  ? 'PASS — MST 26 §6 envelope + soak met'
    : kpis.overallVerdict === 'warn'  ? 'WARN — review envelope / V-drop / T'
    : 'FAIL — MST 26 condition breached';
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${c.bg} ring-1 ${c.ring} ${c.text} text-xs font-medium`}>
      <span className="font-mono">MST 26</span>
      <span>{label}</span>
    </div>
  );
}

export default function RcoAnalysisPanel({ readings, config }: Props) {
  const kpis = useMemo(() => computeRcoKpis(readings, config), [readings, config]);

  const chartData = useMemo(() => {
    if (readings.length === 0) return [];
    const t0 = readings[0].timestamp;
    return readings.map((r) => ({
      tMin: (r.timestamp - t0) / 60000,
      currentA: r.current === undefined ? null : Math.abs(r.current),
      voltageV: r.voltage ?? null,
      tempC: r.temperature ?? null,
    }));
  }, [readings]);

  if (readings.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
        <p className="text-sm text-gray-400">
          No telemetry yet. Start an RCO run — KPIs and the reverse-current
          envelope chart populate as readings stream in.
        </p>
        <p className="text-xs text-gray-500 mt-3">
          IEC 61730-2 MST 26 · target {kpis.testCurrentA.toFixed(2)} A reverse · {config.durationHours} h soak · V-drop limit {config.voltageLimit.toFixed(2)} V
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Test current" value={`${kpis.testCurrentA.toFixed(2)} A`} sub={`1.35 × ${config.fuseRating} A fuse`} />
        <KpiCard label="Measured |I|" value={kpis.measuredCurrentA === null ? '—' : kpis.measuredCurrentA.toFixed(2)} sub={`phase ${kpis.phase}`} />
        <KpiCard label="Soak" value={`${(kpis.soakDurationS / 3600).toFixed(2)} h`} sub={`/ ${config.durationHours} h target`} />
        <KpiCard label="Worst T" value={`${kpis.worstTempC.toFixed(1)} °C`} sub={`ceiling ${RCO_CONSTANTS.T_MAX_C} °C`} />
      </div>

      <VerdictTriple kpis={kpis} voltageLimit={config.voltageLimit} />
      <OverallPill kpis={kpis} />

      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-200">Reverse current envelope &amp; module V-drop</h3>
          <span className="text-[10px] text-gray-500 font-mono">IEC 61730-2 MST 26</span>
        </div>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="tMin" stroke="#9ca3af" tick={{ fontSize: 11 }}
                label={{ value: 'Time (min)', position: 'insideBottom', offset: -2, fill: '#9ca3af', fontSize: 11 }} />
              <YAxis yAxisId="i" stroke="#f87171" tick={{ fontSize: 11 }}
                domain={[0, kpis.testCurrentA * 1.3]}
                label={{ value: '|I| (A)', angle: -90, position: 'insideLeft', fill: '#f87171', fontSize: 11 }} />
              <YAxis yAxisId="v" orientation="right" stroke="#60a5fa" tick={{ fontSize: 11 }}
                label={{ value: 'V', angle: 90, position: 'insideRight', fill: '#60a5fa', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', fontSize: 12 }}
                formatter={(v) => (typeof v === 'number' ? v.toFixed(3) : String(v ?? '—'))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {/* Envelope band: target ±tol% */}
              <ReferenceArea yAxisId="i"
                y1={kpis.testCurrentA * (1 - RCO_CONSTANTS.CURRENT_TOL_PCT / 100)}
                y2={kpis.testCurrentA * (1 + RCO_CONSTANTS.CURRENT_TOL_PCT / 100)}
                fill="#16a34a" fillOpacity={0.10} />
              <ReferenceLine yAxisId="i" y={kpis.testCurrentA} stroke="#f59e0b" strokeDasharray="4 4"
                label={{ value: 'Target 1.35·Isc', fill: '#f59e0b', fontSize: 10, position: 'insideTopLeft' }} />
              <ReferenceLine yAxisId="v" y={config.voltageLimit} stroke="#3b82f6" strokeDasharray="4 4"
                label={{ value: 'V-drop limit', fill: '#3b82f6', fontSize: 10, position: 'insideBottomRight' }} />
              <Line yAxisId="i" type="monotone" dataKey="currentA" name="|I|" stroke="#f87171" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line yAxisId="v" type="monotone" dataKey="voltageV" name="V_drop" stroke="#60a5fa" strokeWidth={1.5} dot={false} isAnimationActive={false} strokeDasharray="3 2" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
