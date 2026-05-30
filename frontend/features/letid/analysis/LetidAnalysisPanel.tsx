'use client';

import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import {
  movingAverage, detectRegenerationOnset, evaluateStopCriterion, judgeLetid,
  type LetidPoint, type LetidVerdict,
} from './regeneration';
import {
  darkVoltageSeries, stopCriterion, measurementUncertainty,
  LETID_DARKV_CONSTANTS,
} from './darkVoltage';
import type { LiveReading } from '@/types/test-session';

interface Props {
  points: LetidPoint[];
  /** Elevated junction temperature of the soak, °C (IEC TS 63342 nominal 75). */
  tjmaxc: number;
  /** Moving-average window, hours. Defaults to 6. */
  windowHrs?: number;
  /**
   * Raw live readings of the soak (optional). When present, the panel adds a
   * dark-voltage / module-temperature / injected-current monitor on a shared
   * time axis plus the TS 63342 stabilization (stop) criterion. When absent
   * (e.g. legacy callers) only the dark V_oc regeneration view is shown.
   */
  readings?: LiveReading[];
}

const VERDICT_STYLE: Record<LetidVerdict, string> = {
  PASS: 'bg-green-900/40 text-green-300 border-green-700/50',
  REVIEW: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50',
  FAIL: 'bg-red-900/40 text-red-300 border-red-700/50',
  IN_PROGRESS: 'bg-blue-900/40 text-blue-300 border-blue-700/50',
};

function VerdictPill({ verdict }: { verdict: LetidVerdict }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded border text-[10px] font-bold ${VERDICT_STYLE[verdict]}`}
      data-testid="letid-verdict-pill"
    >
      {verdict.replace('_', ' ')}
    </span>
  );
}

function StopCriterionPill({ met, reason }: { met: boolean; reason: string }) {
  const style = met
    ? 'bg-green-900/30 text-green-300 ring-green-500/40'
    : 'bg-sky-900/30 text-sky-300 ring-sky-500/40';
  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ring-1 ${style} text-xs font-medium`}
      data-testid="letid-stop-pill"
      title={reason}
    >
      <span className="font-mono">TS 63342 stop</span>
      <span>{met ? 'STABILIZED — stop criterion met' : 'Soaking — not yet stabilized'}</span>
    </div>
  );
}

function fmtH(h: number | null): string {
  return h == null ? '—' : h.toFixed(h % 1 === 0 ? 0 : 1);
}
function fmtV(v: number | null): string {
  return v == null ? '—' : v.toFixed(4);
}
function fmtPct(frac: number | null): string {
  return frac == null ? '—' : `${(frac * 100).toFixed(3)} %`;
}

export default function LetidAnalysisPanel({ points, tjmaxc, windowHrs = 6, readings }: Props) {
  const { data, onset, stop, judgement } = useMemo(() => {
    const smoothed = movingAverage(points, windowHrs);
    const sortedRaw = [...points].sort((a, b) => a.hours - b.hours);
    return {
      data: sortedRaw.map((p, i) => ({
        hours: p.hours,
        raw: p.darkVoc,
        smoothed: smoothed[i]?.smoothedV ?? p.darkVoc,
      })),
      onset: detectRegenerationOnset(smoothed),
      stop: evaluateStopCriterion(smoothed, { plateauWindowHrs: 12, plateauDeltaV: 0.0005 }),
      judgement: judgeLetid(points, tjmaxc, { windowHrs }),
    };
  }, [points, tjmaxc, windowHrs]);

  // Dark-voltage / temperature / injected-current monitor (TS 63342). Derived
  // from the raw live readings: dark-phase samples (|I|≈0) carry the dark
  // voltage; every reading carries module temperature and injected current so
  // all three traces share the elapsed-hours axis. The stop criterion and the
  // dark-voltage uncertainty are evaluated on the dark-phase samples.
  const monitor = useMemo(() => {
    if (!readings || readings.length === 0) return null;
    const dark = darkVoltageSeries(readings);
    const sortedAll = [...readings].sort((a, b) => a.timestamp - b.timestamp);
    const t0 = sortedAll[0].timestamp;
    const series = sortedAll.map((r) => {
      const isDark = Math.abs(r.current) <= LETID_DARKV_CONSTANTS.DARK_CURRENT_EPS_A;
      return {
        hours: (r.timestamp - t0) / 3_600_000,
        darkVoltage: isDark ? r.voltage : null,
        tempC: r.temperature ?? null,
        currentA: r.current,
      };
    });
    const stopResult = stopCriterion(dark);
    const lastDarkV = dark.length > 0 ? dark[dark.length - 1].darkVoltage : null;
    const uncertainty = lastDarkV != null ? measurementUncertainty(lastDarkV) : null;
    return { series, dark, stopResult, lastDarkV, uncertainty };
  }, [readings]);

  if (points.length === 0) {
    return (
      <div className="text-xs text-gray-500 text-center py-12" data-testid="letid-analysis-empty">
        No session yet — start a LeTID test to see regeneration analysis.
      </div>
    );
  }

  const maxHours = data[data.length - 1]?.hours ?? 0;

  return (
    <div className="space-y-4" data-testid="letid-analysis">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-purple-400">
            LeTID — Dark V<sub>oc</sub> Regeneration
          </h3>
          <p className="text-[11px] text-gray-500">
            IEC TS 63342 · moving-average + onset + stop criterion
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] text-gray-500 mb-1">Module verdict</p>
          <VerdictPill verdict={judgement.verdict} />
        </div>
      </div>

      {monitor && (
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-3" data-testid="letid-darkv-monitor">
          <div className="flex items-center justify-between mb-2">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-200">
                Dark Voltage · Module Temperature · Injected Current
              </h3>
              <p className="text-[10px] text-gray-500">IEC TS 63342 · shared time axis</p>
            </div>
            <StopCriterionPill met={monitor.stopResult.met} reason={monitor.stopResult.reason} />
          </div>

          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <LineChart data={monitor.series} margin={{ top: 8, right: 48, bottom: 16, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis
                  type="number" dataKey="hours"
                  tick={{ fill: '#9ca3af', fontSize: 10 }}
                  label={{ value: 'Exposure (h)', position: 'insideBottom', offset: -8, fill: '#6b7280', fontSize: 10 }}
                />
                {/* Left axis carries both the dark voltage (V) and temperature (°C). */}
                <YAxis
                  yAxisId="left" domain={['auto', 'auto']} width={48}
                  tick={{ fill: '#9ca3af', fontSize: 10 }}
                  label={{ value: 'V / °C', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 10 }}
                />
                {/* Right axis carries the injected current (A). */}
                <YAxis
                  yAxisId="right" orientation="right" domain={['auto', 'auto']} width={40}
                  tick={{ fill: '#9ca3af', fontSize: 10 }}
                  label={{ value: 'I (A)', angle: 90, position: 'insideRight', fill: '#6b7280', fontSize: 10 }}
                />
                <Tooltip
                  contentStyle={{ background: '#0b1020', border: '1px solid #374151', fontSize: 12 }}
                  labelFormatter={(h: number) => `${Number(h).toFixed(1)} h`}
                  formatter={(value: number, name: string) => [value == null ? '—' : Number(value).toFixed(3), name]}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line
                  yAxisId="left" type="monotone" dataKey="darkVoltage" name="Dark V (V)"
                  stroke="#a78bfa" strokeWidth={2} dot={false} connectNulls isAnimationActive={false}
                />
                <Line
                  yAxisId="left" type="monotone" dataKey="tempC" name="Module T (°C)"
                  stroke="#fb923c" strokeWidth={1.5} dot={false} isAnimationActive={false}
                />
                <Line
                  yAxisId="right" type="monotone" dataKey="currentA" name="Injected I (A)"
                  stroke="#34d399" strokeWidth={1.5} dot={false} isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {monitor.uncertainty && monitor.lastDarkV != null && (
            <p className="text-[10px] text-gray-400 mt-2" data-testid="letid-uncertainty">
              Last dark voltage{' '}
              <span className="font-mono text-gray-200">
                {monitor.lastDarkV.toFixed(4)} ± {monitor.uncertainty.expanded.toFixed(4)} V
              </span>{' '}
              (k = {monitor.uncertainty.k}, ≈ {(monitor.uncertainty.relative * 100).toFixed(2)} %) — combined cal +
              resolution per GUM / IEC TS 63342.
            </p>
          )}
          <p className="text-[10px] text-gray-500 mt-1" data-testid="letid-stop-reason">{monitor.stopResult.reason}</p>
        </div>
      )}

      <div className="bg-gray-900 border border-gray-700 rounded-lg p-3">
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 24, bottom: 16, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis
                type="number" dataKey="hours"
                domain={[0, Math.ceil(maxHours)]}
                tick={{ fill: '#9ca3af', fontSize: 10 }}
                label={{ value: 'Exposure (h)', position: 'insideBottom', offset: -8, fill: '#6b7280', fontSize: 10 }}
              />
              <YAxis
                domain={['auto', 'auto']} width={52}
                tick={{ fill: '#9ca3af', fontSize: 10 }}
                tickFormatter={(v: number) => v.toFixed(3)}
                label={{ value: 'V_oc (V)', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 10 }}
              />
              <Tooltip
                contentStyle={{ background: '#0b1020', border: '1px solid #374151', fontSize: 12 }}
                labelFormatter={(h: number) => `${Number(h).toFixed(1)} h`}
                formatter={(value: number, name: string) => [Number(value).toFixed(4), name]}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {onset.onsetHours != null && (
                <ReferenceLine
                  x={onset.onsetHours} stroke="#f59e0b" strokeDasharray="4 4"
                  label={{ value: 'Regeneration onset', fill: '#f59e0b', fontSize: 9, position: 'insideTopLeft' }}
                />
              )}
              {stop.atHours != null && (
                <ReferenceLine
                  x={stop.atHours} stroke="#34d399" strokeDasharray="4 4"
                  label={{ value: 'Stop criterion met', fill: '#34d399', fontSize: 9, position: 'insideTopRight' }}
                />
              )}
              <Line
                type="monotone" dataKey="raw" name="Dark V_oc (raw)"
                stroke="#6b7280" strokeWidth={1} dot={false} isAnimationActive={false}
              />
              <Line
                type="monotone" dataKey="smoothed" name={`Moving avg (${windowHrs} h)`}
                stroke="#a78bfa" strokeWidth={2} dot={false} isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <table className="w-full text-[11px] mt-3">
          <tbody className="font-mono">
            <Row label="Window (h)" value={windowHrs.toString()} />
            <Row label="Onset (h)" value={fmtH(judgement.onsetHours)} />
            <Row label="Stop (h)" value={fmtH(judgement.stopHours)} />
            <Row label="Min V_oc (V)" value={fmtV(onset.minV)} />
            <Row label="Final V_oc (V)" value={fmtV(judgement.finalV)} />
            <Row label="ΔV (recovery) (V)" value={fmtV(judgement.deltaVFromMin)} />
          </tbody>
        </table>
        <p className="text-[10px] text-gray-500 mt-1.5" data-testid="letid-verdict-reason">{judgement.reason}</p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-t border-gray-800">
      <td className="py-1 text-gray-400">{label}</td>
      <td className="py-1 text-right text-gray-200">{value}</td>
    </tr>
  );
}
