/**
 * RCO Thermal pane — IEC 61730-2 MST 26 forward-bias hold.
 *
 * Shows the forward-bias readout (1.35×Isc), an IR thermal-image panel
 * (camera snapshot/feed placeholder with caption + metadata), and the
 * module-temperature trace (thermocouple temperature vs time). Same visual
 * language as TcAnalysisPanel / RcoAnalysisPanel.
 */
'use client';

import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine,
  ReferenceArea, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import type { LiveReading } from '@/types/test-session';
import type { Verdict } from './rcoAnalysis';
import {
  forwardBiasSetpoint, clampHoldHours, moduleTempTrace, RCO_THERMAL_CONSTANTS,
} from './rcoThermal';

interface Props {
  readings: LiveReading[];
  /** Rated module short-circuit current (A). */
  isc: number;
  /** Operator-configured forward-bias hold (h) — clamped to [1, 2]. */
  holdHours: number;
  /** Optional IR snapshot URL; when absent a placeholder area is shown. */
  irImageUrl?: string;
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

export default function RcoThermalPanel({ readings, isc, holdHours, irImageUrl }: Props) {
  const setpointA = useMemo(() => forwardBiasSetpoint(isc), [isc]);
  const holdH = useMemo(() => clampHoldHours(holdHours), [holdHours]);
  const trace = useMemo(() => moduleTempTrace(readings), [readings]);
  const vc = verdictColors(trace.verdict);

  // IR snapshot metadata — timestamp/peak sourced from the live trace.
  const lastTs = readings.length ? readings[readings.length - 1].timestamp : null;
  const irCaption = lastTs
    ? `IR snapshot · ${new Date(lastTs).toLocaleTimeString()} · peak ${trace.peakC === null ? '—' : `${trace.peakC.toFixed(1)} °C`}`
    : 'IR snapshot — awaiting forward-bias hold';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KpiCard
          label="Forward-bias setpoint"
          value={`${setpointA.toFixed(2)} A`}
          sub={`1.35 × ${isc} A Isc`}
        />
        <KpiCard
          label="Hold time"
          value={`${holdH.toFixed(2)} h`}
          sub={`clamped to ${RCO_THERMAL_CONSTANTS.HOLD_MIN_H}–${RCO_THERMAL_CONSTANTS.HOLD_MAX_H} h`}
        />
        <KpiCard
          label="Peak surface T"
          value={trace.peakC === null ? '—' : `${trace.peakC.toFixed(1)} °C`}
          sub={`ceiling ${RCO_THERMAL_CONSTANTS.T_CEILING_C} °C`}
        />
      </div>

      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${vc.bg} ring-1 ${vc.ring} ${vc.text} text-xs font-medium`}>
        <span className="font-mono">MST 26 §6</span>
        <span>
          {trace.verdict === 'pending' ? 'Awaiting thermocouple telemetry'
            : trace.verdict === 'pass' ? 'No overheating — surface below ceiling'
            : trace.verdict === 'warn' ? 'WARN — surface approaching ceiling'
            : 'FAIL — surface overheating'}
        </span>
      </div>

      {/* IR thermal-image panel: camera snapshot / feed placeholder. */}
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-200">IR Thermal Image</h3>
          <span className="text-[10px] text-gray-500 font-mono">IEC 61730-2 MST 26</span>
        </div>
        <div className="relative w-full overflow-hidden rounded-md border border-gray-700 bg-gradient-to-br from-indigo-950 via-fuchsia-900/40 to-amber-900/40"
          style={{ aspectRatio: '4 / 3' }}>
          {irImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={irImageUrl} alt="Module IR thermal snapshot" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
              <span className="text-3xl">🌡️</span>
              <p className="mt-2 text-xs text-gray-300">IR camera feed placeholder</p>
              <p className="mt-1 text-[10px] text-gray-400">
                Connect a thermal camera to stream the module hot-spot map during the forward-bias hold.
              </p>
            </div>
          )}
          <div className="absolute bottom-0 inset-x-0 bg-black/50 px-2 py-1 text-[10px] text-gray-200 tabular-nums">
            {irCaption}
          </div>
        </div>
        <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[10px] text-gray-400">
          <div><dt className="inline text-gray-500">Setpoint: </dt><dd className="inline tabular-nums">{setpointA.toFixed(2)} A</dd></div>
          <div><dt className="inline text-gray-500">Hold: </dt><dd className="inline tabular-nums">{holdH.toFixed(2)} h</dd></div>
          <div><dt className="inline text-gray-500">Peak: </dt><dd className="inline tabular-nums">{trace.peakC === null ? '—' : `${trace.peakC.toFixed(1)} °C`}</dd></div>
          <div><dt className="inline text-gray-500">Samples: </dt><dd className="inline tabular-nums">{trace.points.length}</dd></div>
        </dl>
      </div>

      {/* Module-temperature trace from thermocouples. */}
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-200">Module Temperature vs Time (thermocouples)</h3>
          <span className="text-[10px] text-gray-500 font-mono">IEC 61730-2 MST 26</span>
        </div>
        {trace.points.length === 0 ? (
          <p className="text-xs text-gray-500">
            No thermocouple telemetry yet. The module-temperature trace populates
            once the forward-bias hold ({setpointA.toFixed(2)} A for {holdH.toFixed(2)} h) starts.
          </p>
        ) : (
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={trace.points}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="tMin"
                  stroke="#9ca3af"
                  tick={{ fontSize: 11 }}
                  label={{ value: 'Time (min)', position: 'insideBottom', offset: -2, fill: '#9ca3af', fontSize: 11 }}
                />
                <YAxis
                  stroke="#9ca3af"
                  tick={{ fontSize: 11 }}
                  domain={[0, RCO_THERMAL_CONSTANTS.T_CEILING_C + 10]}
                  label={{ value: '°C', angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{ background: '#111827', border: '1px solid #374151', fontSize: 12 }}
                  formatter={(v) => (typeof v === 'number' ? v.toFixed(2) : String(v ?? '—'))}
                />
                <ReferenceArea
                  y1={RCO_THERMAL_CONSTANTS.T_CEILING_C - RCO_THERMAL_CONSTANTS.T_WARN_MARGIN_C}
                  y2={RCO_THERMAL_CONSTANTS.T_CEILING_C}
                  fill="#f59e0b" fillOpacity={0.08}
                />
                <ReferenceLine
                  y={RCO_THERMAL_CONSTANTS.T_CEILING_C}
                  stroke="#ef4444" strokeDasharray="4 4"
                  label={{ value: `Ceiling ${RCO_THERMAL_CONSTANTS.T_CEILING_C} °C`, fill: '#ef4444', fontSize: 10, position: 'insideTopLeft' }}
                />
                <Line type="monotone" dataKey="tempC" name="Module T" stroke="#fb923c" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
