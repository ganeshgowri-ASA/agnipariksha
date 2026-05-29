/**
 * Thermal Cycling analysis panel — IEC 61215-2 MQT 11.
 *
 * Renders the four KPIs that operators consistently asked for and that
 * the original tab was missing:
 *
 *   • Module temperature vs time (with hot/cold dwell shading)
 *   • Cycle counter (N / Target)
 *   • Ramp-rate compliance pill (≤100 / 100-120 / >120 °C/h)
 *   • Isc-gate state pill (Injecting / Cooling)
 *
 * Mirrors the visual language of LetidAnalysisPanel so all IEC tabs
 * eventually look the same — operator muscle memory matters in a lab.
 */
'use client';

import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine,
  ReferenceArea, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import type { LiveReading } from '@/types/test-session';
import {
  computeTcKpis,
  TC_CONSTANTS,
  type RampVerdict,
  type IscGateState,
  type TcConfig,
  type TcKpis,
} from './tcAnalysis';

interface Props {
  readings: LiveReading[];
  config: TcConfig;
}

function verdictColors(v: RampVerdict): { bg: string; ring: string; text: string; label: string } {
  switch (v) {
    case 'pass':    return { bg: 'bg-green-900/30',  ring: 'ring-green-500/40',  text: 'text-green-300',  label: 'PASS — ≤100 °C/h' };
    case 'warn':    return { bg: 'bg-amber-900/30',  ring: 'ring-amber-500/40',  text: 'text-amber-300',  label: 'WARN — 100–120 °C/h' };
    case 'fail':    return { bg: 'bg-red-900/30',    ring: 'ring-red-500/40',    text: 'text-red-300',    label: 'FAIL — >120 °C/h' };
    case 'pending': return { bg: 'bg-gray-800',      ring: 'ring-gray-600/40',   text: 'text-gray-400',   label: 'Pending' };
  }
}

function iscColors(g: IscGateState): { bg: string; text: string; label: string } {
  switch (g) {
    case 'injecting': return { bg: 'bg-orange-900/30', text: 'text-orange-300', label: 'Injecting Isc (T > 25 °C)' };
    case 'cooling':   return { bg: 'bg-sky-900/30',    text: 'text-sky-300',    label: 'Current OFF — cooling phase' };
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

function VerdictPill({ kpis }: { kpis: TcKpis }) {
  const c = verdictColors(kpis.rampVerdict);
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${c.bg} ring-1 ${c.ring} ${c.text} text-xs font-medium`}>
      <span className="font-mono">MQT 11.6.2</span>
      <span>{c.label}</span>
      <span className="opacity-70 tabular-nums">· last {kpis.rampRateCph.toFixed(1)} °C/h</span>
    </div>
  );
}

function IscPill({ kpis }: { kpis: TcKpis }) {
  const c = iscColors(kpis.iscGate);
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${c.bg} ${c.text} text-xs font-medium`}>
      <span className="font-mono">MQT 11.6.3 a</span>
      <span>{c.label}</span>
    </div>
  );
}

export default function TcAnalysisPanel({ readings, config }: Props) {
  const kpis = useMemo(() => computeTcKpis(readings, config), [readings, config]);

  const chartData = useMemo(() => {
    if (readings.length === 0) return [];
    const t0 = readings[0].timestamp;
    return readings.map(r => ({
      tMin: (r.timestamp - t0) / 60000,
      tempC: r.temperature ?? null,
      currentA: r.current,
    }));
  }, [readings]);

  if (readings.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
        <p className="text-sm text-gray-400">
          No telemetry yet. Start a Thermal Cycling run — KPIs and the
          temperature/time chart populate as readings stream in.
        </p>
        <p className="text-xs text-gray-500 mt-3">
          IEC 61215-2 MQT 11 · target {config.cycles} cycles · {config.tMin} … {config.tMax} °C · Isc = {config.isc} A · ramp ≤ {TC_CONSTANTS.MAX_RAMP_C_PER_H} °C/h
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Cycles"
          value={`${kpis.cycleIndex} / ${kpis.cyclesTarget}`}
          sub={kpis.overallVerdict === 'pending' ? 'In progress' : kpis.overallVerdict.toUpperCase()}
        />
        <KpiCard
          label="Module T (°C)"
          value={kpis.tModuleC === null ? '—' : kpis.tModuleC.toFixed(1)}
          sub={`phase: ${kpis.phase}`}
        />
        <KpiCard
          label="Ramp (°C/h)"
          value={kpis.rampRateCph.toFixed(1)}
          sub={`worst ${kpis.worstRampCph.toFixed(1)}`}
        />
        <KpiCard
          label="Dwell (min)"
          value={`${(kpis.hotDwellS / 60).toFixed(0)} · ${(kpis.coldDwellS / 60).toFixed(0)}`}
          sub="hot · cold"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <VerdictPill kpis={kpis} />
        <IscPill kpis={kpis} />
      </div>

      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-200">Module Temperature vs Time</h3>
          <span className="text-[10px] text-gray-500 font-mono">IEC 61215-2 MQT 11</span>
        </div>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="tMin"
                stroke="#9ca3af"
                label={{ value: 'Time (min)', position: 'insideBottom', offset: -2, fill: '#9ca3af', fontSize: 11 }}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                stroke="#9ca3af"
                label={{ value: '°C', angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 11 }}
                tick={{ fontSize: 11 }}
                domain={[config.tMin - 10, config.tMax + 10]}
              />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #374151', fontSize: 12 }}
                formatter={(v) => (typeof v === 'number' ? v.toFixed(2) : String(v ?? '—'))}
              />
              <ReferenceArea y1={config.tMax - 2} y2={config.tMax + 5} fill="#dc2626" fillOpacity={0.08} />
              <ReferenceArea y1={config.tMin - 5} y2={config.tMin + 2} fill="#2563eb" fillOpacity={0.08} />
              <ReferenceLine y={TC_CONSTANTS.ISC_GATE_C} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Isc gate 25 °C', fill: '#f59e0b', fontSize: 10, position: 'insideTopLeft' }} />
              <Line type="monotone" dataKey="tempC" stroke="#fb923c" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
