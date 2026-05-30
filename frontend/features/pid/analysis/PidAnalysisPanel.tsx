/**
 * PID Analysis pane — IEC TS 62804-1 (Method A).
 *
 * Same visual language as TcAnalysisPanel / HfAnalysisPanel / RcoAnalysisPanel.
 */
'use client';

import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ReferenceArea,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import type { LiveReading } from '@/types/test-session';
import {
  computePidKpis, PID_CONSTANTS, type Verdict, type PidConfig, type PidKpis,
} from './pidAnalysis';
import {
  STABILIZATION_CONSTANTS, clampStabilizationHours,
  tempConformity, rhConformity, stabilizationVerdict,
  type StabilizationVerdict,
} from './pidStabilization';

interface Props {
  readings: LiveReading[];
  config: PidConfig;
  /** MQT 21 stabilization soak (h) — clamped to [12, 24]. Defaults to the floor. */
  stabilizationHours?: number;
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

function VerdictQuad({ kpis }: { kpis: PidKpis }) {
  const items: Array<{ label: string; v: Verdict; sub: string }> = [
    {
      label: 'I_leak peak',
      v: kpis.iLeakVerdict,
      sub: `${(kpis.peakILeakA * 1e6).toFixed(2)} µA / ≤${(PID_CONSTANTS.I_LEAK_MAX_A * 1e6).toFixed(1)} µA`,
    },
    {
      label: 'Temperature',
      v: kpis.tempVerdict,
      sub: `worst Δ ${kpis.worstTDevC.toFixed(1)} °C · ±${PID_CONSTANTS.T_TOL_C}`,
    },
    {
      label: 'Humidity',
      v: kpis.rhVerdict,
      sub: `worst Δ ${kpis.worstRhDevPct.toFixed(1)} % · ±${PID_CONSTANTS.RH_TOL_PCT}`,
    },
    {
      label: 'ΔPmax',
      v: kpis.deltaPmaxVerdict,
      sub: kpis.deltaPmaxPct === null
        ? 'baseline + post-test Pmax required'
        : `${kpis.deltaPmaxPct.toFixed(2)} % / ≤${PID_CONSTANTS.DELTA_PMAX_PASS_PCT}`,
    },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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

function OverallPill({ kpis }: { kpis: PidKpis }) {
  const c = verdictColors(kpis.overallVerdict);
  const label =
    kpis.overallVerdict === 'pending' ? `In progress — phase ${kpis.phase}`
    : kpis.overallVerdict === 'pass'  ? 'PASS — TS 62804-1 Gate 2 met'
    : kpis.overallVerdict === 'warn'  ? 'WARN — review I_leak / ΔPmax / env'
    : 'FAIL — TS 62804-1 condition breached';
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${c.bg} ring-1 ${c.ring} ${c.text} text-xs font-medium`}>
      <span className="font-mono">TS 62804-1</span>
      <span>{label}</span>
    </div>
  );
}

function stabColors(v: StabilizationVerdict): { bg: string; ring: string; text: string } {
  switch (v) {
    case 'conform':     return { bg: 'bg-green-900/30', ring: 'ring-green-500/40', text: 'text-green-300' };
    case 'non-conform': return { bg: 'bg-red-900/30',   ring: 'ring-red-500/40',   text: 'text-red-300'   };
    case 'pending':     return { bg: 'bg-gray-800',     ring: 'ring-gray-600/40',  text: 'text-gray-400'  };
  }
}

/** Post-stabilization T/RH conformity pills + NON-CONFORM banner (MQT 21). */
function StabilizationConformity({ kpis, config, stabH }: { kpis: PidKpis; config: PidConfig; stabH: number }) {
  const tV = tempConformity(kpis.tModuleC, config.tempC);
  const rhV = rhConformity(kpis.rhPct, config.rhPct);
  const overall = stabilizationVerdict(kpis.tModuleC, config.tempC, kpis.rhPct, config.rhPct);
  const pills: Array<{ label: string; v: StabilizationVerdict; sub: string }> = [
    {
      label: 'Post-stab T',
      v: tV,
      sub: `${kpis.tModuleC === null ? '—' : kpis.tModuleC.toFixed(1)} °C vs ${config.tempC} ±${STABILIZATION_CONSTANTS.T_TOL_TIGHT_C}`,
    },
    {
      label: 'Post-stab RH',
      v: rhV,
      sub: `${kpis.rhPct === null ? '—' : kpis.rhPct.toFixed(1)} % vs ${config.rhPct} ±${STABILIZATION_CONSTANTS.RH_TOL_TIGHT_PCT}`,
    },
  ];
  return (
    <div className="space-y-2">
      {overall === 'non-conform' && (
        <div className="rounded-lg bg-red-900/30 ring-1 ring-red-500/40 text-red-300 px-3 py-2 text-xs font-bold">
          NON-CONFORM — T/RH outside tight post-stabilization band (MQT 21 · TS 62804-1 §6.2)
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {pills.map((p) => {
          const c = stabColors(p.v);
          return (
            <div key={p.label} className={`rounded-lg ${c.bg} ring-1 ${c.ring} px-3 py-2`}>
              <div className={`text-xs font-medium ${c.text}`}>{p.label}</div>
              <div className={`text-[11px] mt-0.5 ${c.text} opacity-80 tabular-nums`}>{p.sub}</div>
              <div className={`text-[10px] mt-1 uppercase font-bold ${c.text}`}>{p.v}</div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-gray-500">
        Stabilization {stabH} h (MQT 21) · tighter post-stab bands ±{STABILIZATION_CONSTANTS.T_TOL_TIGHT_C} °C / ±{STABILIZATION_CONSTANTS.RH_TOL_TIGHT_PCT} % vs wider in-run ±{STABILIZATION_CONSTANTS.T_TOL_WIDE_C} °C / ±{STABILIZATION_CONSTANTS.RH_TOL_WIDE_PCT} %
      </p>
    </div>
  );
}

export default function PidAnalysisPanel({ readings, config, stabilizationHours }: Props) {
  const kpis = useMemo(() => computePidKpis(readings, config), [readings, config]);
  const stabH = clampStabilizationHours(stabilizationHours ?? STABILIZATION_CONSTANTS.MIN_STABILIZATION_H);

  const chartData = useMemo(() => {
    if (readings.length === 0) return [];
    const t0 = readings[0].timestamp;
    return readings.map((r) => ({
      tHr: (r.timestamp - t0) / 3_600_000,
      iLeakUA: r.current === undefined ? null : Math.abs(r.current) * 1e6,
      tempC: r.temperature ?? null,
      rhPct: (r as LiveReading & { humidity?: number }).humidity ?? null,
    }));
  }, [readings]);

  if (readings.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
        <p className="text-sm text-gray-400">
          No telemetry yet. Start a PID run — leakage current and environmental
          KPIs populate as readings stream in.
        </p>
        <p className="text-xs text-gray-500 mt-3">
          IEC TS 62804-1 Method A · {config.biasVoltage} V bias · {config.tempC} °C / {config.rhPct} %RH · {config.durationHours} h soak
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Bias" value={kpis.biasV === null ? '—' : `${kpis.biasV.toFixed(0)} V`} sub={`target ${config.biasVoltage} V`} />
        <KpiCard label="I_leak (now)" value={kpis.iLeakA === null ? '—' : `${(kpis.iLeakA * 1e6).toFixed(2)} µA`} sub={`peak ${(kpis.peakILeakA * 1e6).toFixed(2)} µA`} />
        <KpiCard label="Module T" value={kpis.tModuleC === null ? '—' : `${kpis.tModuleC.toFixed(1)} °C`} sub={`target ${config.tempC} °C`} />
        <KpiCard label="Soak" value={`${(kpis.soakDurationS / 3600).toFixed(1)} h`} sub={`/ ${config.durationHours} h target`} />
      </div>

      <VerdictQuad kpis={kpis} />
      <OverallPill kpis={kpis} />
      <StabilizationConformity kpis={kpis} config={config} stabH={stabH} />

      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-200">Leakage current, T &amp; RH (post-stab conformity bands)</h3>
          <span className="text-[10px] text-gray-500 font-mono">IEC TS 62804-1 · MQT 21</span>
        </div>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="tHr" stroke="#9ca3af" tick={{ fontSize: 11 }}
                tickFormatter={(v: number) => v.toFixed(1)}
                label={{ value: 'Time (h)', position: 'insideBottom', offset: -2, fill: '#9ca3af', fontSize: 11 }} />
              <YAxis yAxisId="i" stroke="#a855f7" tick={{ fontSize: 11 }}
                label={{ value: 'I_leak (µA)', angle: -90, position: 'insideLeft', fill: '#a855f7', fontSize: 11 }} />
              <YAxis yAxisId="t" orientation="right" stroke="#f59e0b" tick={{ fontSize: 11 }}
                domain={[config.tempC - 10, config.tempC + 10]}
                label={{ value: 'T (°C)', angle: 90, position: 'insideRight', fill: '#f59e0b', fontSize: 11 }} />
              {/* Hidden RH axis (0–100 %) so the RH line + RH conformity bands share a correct scale. */}
              <YAxis yAxisId="rh" orientation="right" domain={[0, 100]} hide />
              <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', fontSize: 12 }}
                formatter={(v) => (typeof v === 'number' ? v.toFixed(3) : String(v ?? '—'))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {/* Tight post-stab T band (inner) over the wider in-run band (outer) — MQT 21 / TS 62804-1 §6.2. */}
              <ReferenceArea yAxisId="t" y1={config.tempC - STABILIZATION_CONSTANTS.T_TOL_WIDE_C} y2={config.tempC + STABILIZATION_CONSTANTS.T_TOL_WIDE_C} fill="#f59e0b" fillOpacity={0.06} />
              <ReferenceArea yAxisId="t" y1={config.tempC - STABILIZATION_CONSTANTS.T_TOL_TIGHT_C} y2={config.tempC + STABILIZATION_CONSTANTS.T_TOL_TIGHT_C} fill="#22c55e" fillOpacity={0.1} />
              {/* Tight post-stab RH band (inner) over the wider in-run band (outer). */}
              <ReferenceArea yAxisId="rh" y1={config.rhPct - STABILIZATION_CONSTANTS.RH_TOL_WIDE_PCT} y2={config.rhPct + STABILIZATION_CONSTANTS.RH_TOL_WIDE_PCT} fill="#22d3ee" fillOpacity={0.05} />
              <ReferenceArea yAxisId="rh" y1={config.rhPct - STABILIZATION_CONSTANTS.RH_TOL_TIGHT_PCT} y2={config.rhPct + STABILIZATION_CONSTANTS.RH_TOL_TIGHT_PCT} fill="#22c55e" fillOpacity={0.08} />
              <ReferenceLine yAxisId="i" y={PID_CONSTANTS.I_LEAK_MAX_A * 1e6} stroke="#ef4444" strokeDasharray="4 4"
                label={{ value: 'I_leak max', fill: '#ef4444', fontSize: 10, position: 'insideTopLeft' }} />
              <ReferenceLine yAxisId="t" y={config.tempC} stroke="#f59e0b" strokeDasharray="4 4"
                label={{ value: 'T setpoint', fill: '#f59e0b', fontSize: 10, position: 'insideTopRight' }} />
              <Line yAxisId="i" type="monotone" dataKey="iLeakUA" name="I_leak (µA)" stroke="#a855f7" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line yAxisId="t" type="monotone" dataKey="tempC" name="T (°C)" stroke="#f59e0b" strokeWidth={1.5} dot={false} isAnimationActive={false} strokeDasharray="3 2" />
              <Line yAxisId="rh" type="monotone" dataKey="rhPct" name="RH (%)" stroke="#22d3ee" strokeWidth={1.5} dot={false} isAnimationActive={false} strokeDasharray="3 2" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
