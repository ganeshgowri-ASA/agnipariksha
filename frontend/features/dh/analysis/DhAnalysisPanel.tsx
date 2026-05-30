'use client';

import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import type { LiveReading } from '@/types/test-session';
import { computeDhKpis, DH_CONSTANTS, type Verdict, type DhConfig, type DhKpis } from './dhAnalysis';

interface Props { readings: LiveReading[]; config: DhConfig }

function vc(v: Verdict) {
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

function VerdictQuad({ kpis }: { kpis: DhKpis }) {
  const items: Array<{ label: string; v: Verdict; sub: string }> = [
    { label: 'Temperature', v: kpis.tempVerdict, sub: `worst Δ ${kpis.worstTDevC.toFixed(1)} °C · ±${DH_CONSTANTS.T_TOL_C}` },
    { label: 'Humidity',    v: kpis.rhVerdict,   sub: `worst Δ ${kpis.worstRhDevPct.toFixed(1)} % · ±${DH_CONSTANTS.RH_TOL_PCT}` },
    { label: 'Soak',        v: kpis.soakDurationVerdict, sub: `${(kpis.soakDurationS / 3600).toFixed(1)} h target` },
    { label: 'ΔPmax',       v: kpis.deltaPmaxVerdict,
      sub: kpis.deltaPmaxPct === null ? 'baseline required' : `${kpis.deltaPmaxPct.toFixed(2)} % / ≤${DH_CONSTANTS.DELTA_PMAX_PASS_PCT}` },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {items.map(it => {
        const c = vc(it.v);
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

function OverallPill({ kpis }: { kpis: DhKpis }) {
  const c = vc(kpis.overallVerdict);
  const label =
    kpis.overallVerdict === 'pending' ? `In progress — phase ${kpis.phase}` :
    kpis.overallVerdict === 'pass'    ? 'PASS — MQT 13 Gate-2 met' :
    kpis.overallVerdict === 'warn'    ? 'WARN — review env / ΔPmax' :
    'FAIL — MQT 13 condition breached';
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${c.bg} ring-1 ${c.ring} ${c.text} text-xs font-medium`}>
      <span className="font-mono">MQT 13</span><span>{label}</span>
    </div>
  );
}

export default function DhAnalysisPanel({ readings, config }: Props) {
  const kpis = useMemo(() => computeDhKpis(readings, config), [readings, config]);

  const chartData = useMemo(() => {
    if (readings.length === 0) return [];
    const t0 = readings[0].timestamp;
    return readings.map(r => {
      const rh = (r as LiveReading & { humidity?: number }).humidity;
      return {
        tHr: (r.timestamp - t0) / 3_600_000,
        tempC: r.temperature ?? null,
        rhPct: typeof rh === 'number' ? rh : null,
      };
    });
  }, [readings]);

  if (readings.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
        <p className="text-sm text-gray-400">No telemetry yet. Start a DH run to populate KPIs.</p>
        <p className="text-xs text-gray-500 mt-3">IEC 61215-2 MQT 13 · {config.tempC} °C / {config.rhPct} %RH · {config.durationHours} h soak</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Module T" value={kpis.tModuleC === null ? '—' : `${kpis.tModuleC.toFixed(1)} °C`} sub={`target ${config.tempC} °C`} />
        <KpiCard label="RH" value={kpis.rhPct === null ? 'n/a' : `${kpis.rhPct.toFixed(1)} %`} sub={`target ${config.rhPct} %`} />
        <KpiCard label="Soak" value={`${(kpis.soakDurationS / 3600).toFixed(1)} h`} sub={`/ ${config.durationHours} h`} />
        <KpiCard label="Phase" value={kpis.phase} />
      </div>

      <VerdictQuad kpis={kpis} />
      <OverallPill kpis={kpis} />

      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-200">Module T &amp; RH vs Time</h3>
          <span className="text-[10px] text-gray-500 font-mono">IEC 61215-2 MQT 13</span>
        </div>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="tHr" stroke="#9ca3af" tick={{ fontSize: 11 }}
                tickFormatter={(v: number) => v.toFixed(0)}
                label={{ value: 'Time (h)', position: 'insideBottom', offset: -2, fill: '#9ca3af', fontSize: 11 }} />
              <YAxis yAxisId="t" stroke="#60a5fa" tick={{ fontSize: 11 }}
                domain={[config.tempC - 10, config.tempC + 10]}
                label={{ value: '°C', angle: -90, position: 'insideLeft', fill: '#60a5fa', fontSize: 11 }} />
              <YAxis yAxisId="rh" orientation="right" stroke="#22d3ee" tick={{ fontSize: 11 }} domain={[60, 100]}
                label={{ value: '%RH', angle: 90, position: 'insideRight', fill: '#22d3ee', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', fontSize: 12 }}
                formatter={(v) => (typeof v === 'number' ? v.toFixed(2) : String(v ?? '—'))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine yAxisId="t" y={config.tempC} stroke="#f59e0b" strokeDasharray="4 4"
                label={{ value: 'T setpoint', fill: '#f59e0b', fontSize: 10, position: 'insideTopLeft' }} />
              <Line yAxisId="t" type="monotone" dataKey="tempC" name="Module T" stroke="#60a5fa" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line yAxisId="rh" type="monotone" dataKey="rhPct" name="RH" stroke="#22d3ee" strokeWidth={1.5} dot={false} isAnimationActive={false} strokeDasharray="3 2" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
