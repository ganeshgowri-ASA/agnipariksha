/**
 * Ramp — SET vs ACTUAL (point-to-point & cumulative) — IEC 61215-2 MQT 11.
 *
 * Complements TcAnalysisPanel: shows the operator/program ramp setpoint
 * against the two MEASURED ramp figures derived from the live telemetry —
 *   • point-to-point (instantaneous worst consecutive-sample ramp)
 *   • cumulative (run-averaged ramp)
 * as a small table AND a grouped bar chart, with the selected bifacial
 * position's ceiling drawn as a reference line and a verdict pill citing
 * the clause in force (MQT 11.6.2 / 11.6.1 per position).
 *
 * Mirrors the visual language of TcAnalysisPanel (dark theme, recharts,
 * clause pills) so the two panes read as one Analysis surface.
 */
'use client';

import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import type { LiveReading } from '@/types/test-session';
import type { RampVerdict } from './tcAnalysis';
import {
  rampSetVsActual,
  type ModulePosition,
} from './tcExtensions';

interface Props {
  readings: LiveReading[];
  /** Operator/program ramp setpoint (°C/h). */
  rampRateCph: number;
  /** Selected bifacial module position — selects the tolerance set. */
  position: ModulePosition;
  /** Junction-box mass loading (kg) — surfaced so it can reach the report. */
  massLoadingKg: number;
}

function verdictColors(v: RampVerdict): { bg: string; ring: string; text: string; label: string } {
  switch (v) {
    case 'pass':    return { bg: 'bg-green-900/30', ring: 'ring-green-500/40', text: 'text-green-300', label: 'PASS — within ceiling' };
    case 'warn':    return { bg: 'bg-amber-900/30', ring: 'ring-amber-500/40', text: 'text-amber-300', label: 'WARN — in warning band' };
    case 'fail':    return { bg: 'bg-red-900/30',   ring: 'ring-red-500/40',   text: 'text-red-300',   label: 'FAIL — over warning band' };
    case 'pending': return { bg: 'bg-gray-800',     ring: 'ring-gray-600/40',  text: 'text-gray-400',  label: 'Pending — awaiting telemetry' };
  }
}

/** One row of the SET-vs-ACTUAL table. */
function RampRow({
  label, setCph, actualCph, deltaCph,
}: { label: string; setCph: number; actualCph: number; deltaCph: number }) {
  const over = deltaCph > 0;
  return (
    <tr className="border-t border-gray-700">
      <td className="py-1.5 pr-3 text-gray-300">{label}</td>
      <td className="py-1.5 px-3 text-right tabular-nums text-gray-200">{setCph.toFixed(1)}</td>
      <td className="py-1.5 px-3 text-right tabular-nums text-gray-100">{actualCph.toFixed(1)}</td>
      <td className={`py-1.5 pl-3 text-right tabular-nums ${over ? 'text-amber-300' : 'text-green-300'}`}>
        {deltaCph >= 0 ? '+' : ''}{deltaCph.toFixed(1)}
      </td>
    </tr>
  );
}

export default function TcRampSetVsActualPanel({
  readings, rampRateCph, position, massLoadingKg,
}: Props) {
  const cmp = useMemo(
    () => rampSetVsActual(readings, { rampRateCph, position }),
    [readings, rampRateCph, position],
  );

  const chartData = useMemo(() => ([
    { name: 'Point-to-point', set: cmp.pointToPoint.setCph, actual: cmp.pointToPoint.actualCph },
    { name: 'Cumulative',     set: cmp.cumulative.setCph,   actual: cmp.cumulative.actualCph },
  ]), [cmp]);

  const vc = verdictColors(cmp.verdict);
  const tol = cmp.tolerance;

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200">
          Ramp — set vs actual (point-to-point &amp; cumulative)
        </h3>
        <span className="text-[10px] text-gray-500 font-mono">IEC 61215-2 {tol.clause}</span>
      </div>

      {/* Clause + verdict + mass-loading context pills */}
      <div className="flex flex-wrap gap-2">
        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${vc.bg} ring-1 ${vc.ring} ${vc.text} text-xs font-medium`}>
          <span className="font-mono">{tol.clause}</span>
          <span>{vc.label}</span>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-800 text-gray-300 text-xs">
          <span className="font-mono">{position}</span>
          <span>ceiling {tol.maxRampCph} °C/h · plateau ±{tol.tempToleranceC} °C</span>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-800 text-gray-300 text-xs">
          <span className="font-mono">MQT 11 mass</span>
          <span className="tabular-nums">{massLoadingKg.toFixed(2)} kg</span>
        </div>
      </div>

      {/* SET vs ACTUAL table */}
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-400">
            <th className="py-1 pr-3 text-left font-medium">Ramp (°C/h)</th>
            <th className="py-1 px-3 text-right font-medium">Set</th>
            <th className="py-1 px-3 text-right font-medium">Actual</th>
            <th className="py-1 pl-3 text-right font-medium">Δ (act−set)</th>
          </tr>
        </thead>
        <tbody>
          <RampRow
            label="Point-to-point (worst)"
            setCph={cmp.pointToPoint.setCph}
            actualCph={cmp.pointToPoint.actualCph}
            deltaCph={cmp.pointToPoint.deltaCph}
          />
          <RampRow
            label="Cumulative (average)"
            setCph={cmp.cumulative.setCph}
            actualCph={cmp.cumulative.actualCph}
            deltaCph={cmp.cumulative.deltaCph}
          />
        </tbody>
      </table>

      {/* Grouped SET vs ACTUAL bar chart, ceiling as reference line */}
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <BarChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="name" stroke="#9ca3af" tick={{ fontSize: 11 }} />
            <YAxis
              stroke="#9ca3af"
              tick={{ fontSize: 11 }}
              label={{ value: '°C/h', angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{ background: '#111827', border: '1px solid #374151', fontSize: 12 }}
              formatter={(v) => (typeof v === 'number' ? `${v.toFixed(1)} °C/h` : String(v ?? '—'))}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine
              y={tol.maxRampCph}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              label={{ value: `ceiling ${tol.maxRampCph}`, fill: '#f59e0b', fontSize: 10, position: 'right' }}
            />
            <Bar dataKey="set" name="Set" fill="#64748b" isAnimationActive={false} />
            <Bar dataKey="actual" name="Actual" fill="#fb923c" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
