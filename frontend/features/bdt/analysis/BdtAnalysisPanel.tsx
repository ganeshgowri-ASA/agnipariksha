'use client';

import { useMemo } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {
  judgeDiode, judgeModule,
  type DiodeSeries, type DiodeJudgement, type Verdict,
} from './regression';

interface Props {
  diodes: DiodeSeries[];
  /** Safe |V_D(T_jmax)| band, V. Defaults to the Mitsui template's 0.6 V. */
  safeVdBandV?: number;
}

const VERDICT_STYLE: Record<Verdict, string> = {
  PASS: 'bg-green-900/40 text-green-300 border-green-700/50',
  REVIEW: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50',
  FAIL: 'bg-red-900/40 text-red-300 border-red-700/50',
};

function VerdictPill({ verdict }: { verdict: Verdict }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded border text-[10px] font-bold ${VERDICT_STYLE[verdict]}`}
      data-testid="verdict-pill"
    >
      {verdict}
    </span>
  );
}

export default function BdtAnalysisPanel({ diodes, safeVdBandV = 0.6 }: Props) {
  const judged = useMemo(
    () => diodes.map(d => ({
      series: d,
      judgement: judgeDiode(d.diodeId, d.points, d.tjmaxc, safeVdBandV),
    })),
    [diodes, safeVdBandV],
  );

  const moduleVerdict = useMemo(
    () => judgeModule(judged.map(j => j.judgement)),
    [judged],
  );

  if (diodes.length === 0) {
    return (
      <div className="text-xs text-gray-500 text-center py-12" data-testid="bdt-analysis-empty">
        No session yet — start a test to see analysis.
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="bdt-analysis">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-yellow-400">
            Bypass Diode — V<sub>D</sub> vs T<sub>j</sub> Regression
          </h3>
          <p className="text-[11px] text-gray-500">
            IEC 61215-2 MQT 18.1 · per-diode OLS characteristic, extrapolated to T<sub>jmax</sub>
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] text-gray-500 mb-1">Module verdict</p>
          <VerdictPill verdict={moduleVerdict} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {judged.map(({ series, judgement }) => (
          <DiodeCard key={series.diodeId} series={series} judgement={judgement} />
        ))}
      </div>
    </div>
  );
}

function DiodeCard({ series, judgement }: { series: DiodeSeries; judgement: DiodeJudgement }) {
  const { fit, vAtTjmaxV, verdict, reason } = judgement;

  const xs = series.points.map(p => p.tjc);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs, series.tjmaxc);
  // Fit line drawn across the data and out to T_jmax to show the extrapolation.
  const segment = [
    { x: xMin, y: fit.slope * xMin + fit.intercept },
    { x: xMax, y: fit.slope * xMax + fit.intercept },
  ];
  const scatterData = series.points.map(p => ({ x: p.tjc, y: p.vdropv }));

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3" data-testid={`bdt-diode-${series.diodeId}`}>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold text-gray-200">{series.diodeId}</h4>
        <VerdictPill verdict={verdict} />
      </div>

      <div style={{ width: '100%', height: 200 }}>
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis
              type="number" dataKey="x" name="T_j" unit="°C"
              domain={[Math.floor(xMin - 5), Math.ceil(xMax + 5)]}
              tick={{ fill: '#9ca3af', fontSize: 10 }}
              label={{ value: 'T_j (°C)', position: 'insideBottom', offset: -8, fill: '#6b7280', fontSize: 10 }}
            />
            <YAxis
              type="number" dataKey="y" name="V_D" unit="V"
              domain={['auto', 'auto']}
              width={48}
              tick={{ fill: '#9ca3af', fontSize: 10 }}
              tickFormatter={(v: number) => v.toFixed(3)}
            />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              contentStyle={{ background: '#0b1020', border: '1px solid #374151', fontSize: 12 }}
              formatter={(value: number, name: string) => [Number(value).toFixed(4), name]}
            />
            <ReferenceLine segment={segment} stroke="#f59e0b" strokeWidth={1.5} ifOverflow="extendDomain" />
            <ReferenceLine
              x={series.tjmaxc} stroke="#ef4444" strokeDasharray="4 4"
              label={{ value: 'T_jmax', fill: '#ef4444', fontSize: 9, position: 'insideTopRight' }}
            />
            <Scatter data={scatterData} fill="#60a5fa" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      <table className="w-full text-[11px] mt-2">
        <tbody className="font-mono">
          <Row label="Slope" value={`${fit.slope.toExponential(2)} V/°C`} />
          <Row label="Intercept" value={`${fit.intercept.toFixed(4)} V`} />
          <Row label="R²" value={fit.r2.toFixed(4)} />
          <Row label={`V_D(T_jmax = ${series.tjmaxc} °C)`} value={`${vAtTjmaxV.toFixed(4)} V`} />
        </tbody>
      </table>
      <p className="text-[10px] text-gray-500 mt-1.5">{reason}</p>
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
