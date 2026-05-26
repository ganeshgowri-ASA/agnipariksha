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

interface Props {
  points: LetidPoint[];
  /** Elevated junction temperature of the soak, °C (IEC TS 63342 nominal 75). */
  tjmaxc: number;
  /** Moving-average window, hours. Defaults to 6. */
  windowHrs?: number;
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

function fmtH(h: number | null): string {
  return h == null ? '—' : h.toFixed(h % 1 === 0 ? 0 : 1);
}
function fmtV(v: number | null): string {
  return v == null ? '—' : v.toFixed(4);
}

export default function LetidAnalysisPanel({ points, tjmaxc, windowHrs = 6 }: Props) {
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
