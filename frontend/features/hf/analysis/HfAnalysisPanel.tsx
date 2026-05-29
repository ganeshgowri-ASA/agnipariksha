/**
 * Humidity Freeze analysis panel — IEC 61215-2 MQT 12.
 *
 * Same visual language as TcAnalysisPanel — operator muscle memory.
 */
'use client';

import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine,
  ReferenceArea, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import type { LiveReading } from '@/types/test-session';
import {
  computeHfKpis,
  HF_CONSTANTS,
  type DwellVerdict,
  type RhVerdict,
  type IscGateState,
  type HfConfig,
  type HfKpis,
} from './hfAnalysis';

interface Props {
  readings: LiveReading[];
  config: HfConfig;
}

function dwellColors(v: DwellVerdict): { bg: string; ring: string; text: string } {
  switch (v) {
    case 'pass':    return { bg: 'bg-green-900/30',  ring: 'ring-green-500/40',  text: 'text-green-300' };
    case 'warn':    return { bg: 'bg-amber-900/30',  ring: 'ring-amber-500/40',  text: 'text-amber-300' };
    case 'fail':    return { bg: 'bg-red-900/30',    ring: 'ring-red-500/40',    text: 'text-red-300'   };
    case 'pending': return { bg: 'bg-gray-800',      ring: 'ring-gray-600/40',   text: 'text-gray-400'  };
  }
}

function iscColors(g: IscGateState): { bg: string; text: string; label: string } {
  switch (g) {
    case 'injecting': return { bg: 'bg-orange-900/30', text: 'text-orange-300', label: 'Injecting Isc (T > 25 °C)' };
    case 'cooling':   return { bg: 'bg-sky-900/30',    text: 'text-sky-300',    label: 'Current OFF — freeze phase' };
    case 'unknown':   return { bg: 'bg-gray-800',      text: 'text-gray-400',   label: 'Awaiting telemetry' };
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

function DwellPill({ kpis }: { kpis: HfKpis }) {
  // Combine hot + cold + rh into a single overall pill for at-a-glance scan.
  const overall = kpis.overallVerdict;
  const c = dwellColors(overall);
  const label =
    overall === 'pending' ? `In progress — cycle ${kpis.cycleIndex} / ${kpis.cyclesTarget}`
    : overall === 'pass'  ? 'PASS — MQT 12 fundamentals met'
    : overall === 'warn'  ? 'WARN — review dwell or RH'
    : 'FAIL — dwell/RH out of spec';
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${c.bg} ring-1 ${c.ring} ${c.text} text-xs font-medium`}>
      <span className="font-mono">MQT 12</span>
      <span>{label}</span>
    </div>
  );
}

function IscPill({ kpis }: { kpis: HfKpis }) {
  const c = iscColors(kpis.iscGate);
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${c.bg} ${c.text} text-xs font-medium`}>
      <span className="font-mono">MQT 11.6.3 a</span>
      <span>{c.label}</span>
    </div>
  );
}

function VerdictTriple({ kpis }: { kpis: HfKpis }) {
  const items: Array<{ label: string; v: DwellVerdict | RhVerdict; sub: string }> = [
    {
      label: 'Hot dwell',
      v: kpis.hotDwellVerdict,
      sub: `${(kpis.hotDwellS / 3600).toFixed(1)}h / ≥${HF_CONSTANTS.HOT_DWELL_MIN_S / 3600}h`,
    },
    {
      label: 'Cold dwell',
      v: kpis.coldDwellVerdict,
      sub: `${(kpis.coldDwellS / 60).toFixed(0)}min / ≥${HF_CONSTANTS.COLD_DWELL_MIN_S / 60}min`,
    },
    {
      label: 'RH soak',
      v: kpis.rhVerdict,
      sub: `${HF_CONSTANTS.RH_TARGET_PCT}±${HF_CONSTANTS.RH_TOL_PCT}% · worst Δ ${kpis.worstRhDevPct.toFixed(1)}%`,
    },
  ];
  return (
    <div className="grid grid-cols-3 gap-3">
      {items.map((it) => {
        const c = dwellColors(it.v as DwellVerdict);
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

export default function HfAnalysisPanel({ readings, config }: Props) {
  const kpis = useMemo(() => computeHfKpis(readings, config), [readings, config]);

  const chartData = useMemo(() => {
    if (readings.length === 0) return [];
    const t0 = readings[0].timestamp;
    return readings.map((r) => {
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
        <p className="text-sm text-gray-400">
          No telemetry yet. Start a Humidity Freeze run — KPIs and the
          temperature/RH chart populate as readings stream in.
        </p>
        <p className="text-xs text-gray-500 mt-3">
          IEC 61215-2 MQT 12 · target {config.cycles} cycles · {config.tHigh} °C/{config.rhHigh}%RH ↔ {config.tLow} °C · hot dwell ≥{HF_CONSTANTS.HOT_DWELL_MIN_S / 3600} h
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Cycles" value={`${kpis.cycleIndex} / ${kpis.cyclesTarget}`} sub={`phase: ${kpis.phase}`} />
        <KpiCard label="Module T (°C)" value={kpis.tModuleC === null ? '—' : kpis.tModuleC.toFixed(1)} sub={`target ${config.tHigh} / ${config.tLow}`} />
        <KpiCard label="RH (%)" value={kpis.rhPct === null ? 'n/a' : kpis.rhPct.toFixed(1)} sub={`target ${config.rhHigh} ± ${HF_CONSTANTS.RH_TOL_PCT}`} />
        <KpiCard label="Hot · Cold (cum.)" value={`${(kpis.hotDwellS / 3600).toFixed(1)}h · ${(kpis.coldDwellS / 60).toFixed(0)}m`} sub="≥20h · ≥30m" />
      </div>

      <VerdictTriple kpis={kpis} />

      <div className="flex flex-wrap gap-2">
        <DwellPill kpis={kpis} />
        <IscPill kpis={kpis} />
      </div>

      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-200">Module T & RH vs Time</h3>
          <span className="text-[10px] text-gray-500 font-mono">IEC 61215-2 MQT 12</span>
        </div>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="tHr"
                stroke="#9ca3af"
                tickFormatter={(v: number) => v.toFixed(1)}
                label={{ value: 'Time (h)', position: 'insideBottom', offset: -2, fill: '#9ca3af', fontSize: 11 }}
                tick={{ fontSize: 11 }}
              />
              <YAxis yAxisId="t" stroke="#9ca3af" tick={{ fontSize: 11 }}
                domain={[config.tLow - 10, config.tHigh + 10]}
                label={{ value: '°C', angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 11 }} />
              <YAxis yAxisId="rh" orientation="right" stroke="#22d3ee" tick={{ fontSize: 11 }} domain={[0, 100]}
                label={{ value: '%RH', angle: 90, position: 'insideRight', fill: '#22d3ee', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #374151', fontSize: 12 }}
                formatter={(v) => (typeof v === 'number' ? v.toFixed(2) : String(v ?? '—'))}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceArea yAxisId="t" y1={config.tHigh - HF_CONSTANTS.T_HOT_TOL_C} y2={config.tHigh + HF_CONSTANTS.T_HOT_TOL_C} fill="#dc2626" fillOpacity={0.08} />
              <ReferenceArea yAxisId="t" y1={config.tLow - HF_CONSTANTS.T_COLD_TOL_C} y2={config.tLow + HF_CONSTANTS.T_COLD_TOL_C} fill="#2563eb" fillOpacity={0.08} />
              <ReferenceLine yAxisId="t" y={HF_CONSTANTS.ISC_GATE_C} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Isc gate 25 °C', fill: '#f59e0b', fontSize: 10, position: 'insideTopLeft' }} />
              <Line yAxisId="t" type="monotone" dataKey="tempC" name="Module T" stroke="#60a5fa" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line yAxisId="rh" type="monotone" dataKey="rhPct" name="RH" stroke="#22d3ee" strokeWidth={1.5} dot={false} isAnimationActive={false} strokeDasharray="3 2" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
