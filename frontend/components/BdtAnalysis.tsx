'use client';

import { useMemo } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {
  analyseDiodes, SAFE_VD_BAND_V,
  type BdtRecipeMin, type DiodeMeasurement, type Verdict,
} from '@/lib/bdt-regression';

interface Props {
  diodes: DiodeMeasurement[];
  recipe: BdtRecipeMin;
  safeBand?: number;
}

const VERDICT_STYLE: Record<Verdict, string> = {
  PASS:   'bg-green-900/40 text-green-300 border border-green-700/60',
  REVIEW: 'bg-yellow-900/40 text-yellow-300 border border-yellow-700/60',
  FAIL:   'bg-red-900/40 text-red-300 border border-red-700/60',
};

const POINT_COLOR = '#fbbf24';
const FIT_COLOR = '#60a5fa';

function VerdictPill({ verdict }: { verdict: Verdict }) {
  return (
    <span
      data-testid={`bdt-verdict-${verdict}`}
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${VERDICT_STYLE[verdict]}`}
    >
      {verdict}
    </span>
  );
}

export default function BdtAnalysis({ diodes, recipe, safeBand = SAFE_VD_BAND_V }: Props) {
  const result = useMemo(
    () => analyseDiodes(diodes, recipe.Tjmax, safeBand),
    [diodes, recipe.Tjmax, safeBand],
  );

  if (diodes.length === 0 || diodes.every(d => d.points.length === 0)) {
    return (
      <div className="text-xs text-gray-500 text-center py-12" data-testid="bdt-analysis-empty">
        No diode V_drop–T_j data yet — run an MQT 18.1 sweep to populate the analysis.
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="bdt-analysis">
      <div className="flex items-center justify-between bg-gray-900 border border-gray-700 rounded-lg p-3">
        <div>
          <h3 className="text-sm font-bold text-yellow-400">Bypass Diode — V_drop vs T_j (MQT 18.1)</h3>
          <p className="text-[10px] text-gray-500 mt-0.5">
            Linear fit extrapolated to Tjmax = {recipe.Tjmax}°C · safe band ±{safeBand} V
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 uppercase">Module</span>
          <VerdictPill verdict={result.module} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {result.diodes.map(d => {
          const tjs = d.points.map(p => p.tj);
          const xMin = Math.min(...tjs);
          const fitLine = [
            { tj: xMin, vdrop: d.fit.slope * xMin + d.fit.intercept },
            { tj: recipe.Tjmax, vdrop: d.extrapolatedVd },
          ];
          return (
            <div
              key={d.diodeId}
              className="bg-gray-900 border border-gray-700 rounded-lg p-3"
              data-testid={`bdt-diode-chart-${d.diodeId}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-300">{d.diodeId}</span>
                <VerdictPill verdict={d.verdict} />
              </div>
              <div style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer>
                  <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis
                      type="number" dataKey="tj" name="T_j" unit="°C"
                      tick={{ fill: '#9ca3af', fontSize: 10 }}
                      domain={['dataMin - 2', Math.max(recipe.Tjmax, ...tjs) + 2]}
                      label={{ value: 'T_j (°C)', fill: '#6b7280', fontSize: 10, position: 'insideBottom', offset: -8 }}
                    />
                    <YAxis
                      type="number" dataKey="vdrop" name="V_drop" unit="V"
                      tick={{ fill: '#9ca3af', fontSize: 10 }} width={48}
                      tickFormatter={v => v.toFixed(3)}
                    />
                    <Tooltip
                      contentStyle={{ background: '#0b1020', border: '1px solid #374151', fontSize: 12 }}
                      formatter={(v: number, name: string) => [
                        name === 'V_drop' ? `${v.toFixed(4)} V` : `${v.toFixed(1)} °C`, name,
                      ]}
                    />
                    <ReferenceLine
                      x={recipe.Tjmax} stroke="#ef4444" strokeDasharray="4 4"
                      label={{ value: 'Tjmax', fill: '#ef4444', fontSize: 9, position: 'top' }}
                    />
                    <Scatter name="V_drop" data={d.points} fill={POINT_COLOR} isAnimationActive={false} />
                    <Scatter
                      name="fit" data={fitLine} line={{ stroke: FIT_COLOR, strokeWidth: 1.5 }}
                      shape={() => <></>} legendType="none" isAnimationActive={false}
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 overflow-x-auto">
        <h3 className="text-xs font-semibold text-gray-300 mb-2">Fit coefficients</h3>
        <table className="w-full text-xs" data-testid="bdt-coeff-table">
          <thead>
            <tr className="text-gray-500 text-left border-b border-gray-700">
              <th className="py-1.5 pr-3 font-medium">Diode</th>
              <th className="py-1.5 pr-3 font-medium">Slope (V/°C)</th>
              <th className="py-1.5 pr-3 font-medium">Intercept (V)</th>
              <th className="py-1.5 pr-3 font-medium">R²</th>
              <th className="py-1.5 pr-3 font-medium">V_drop @ Tjmax (V)</th>
              <th className="py-1.5 pr-3 font-medium">Verdict</th>
            </tr>
          </thead>
          <tbody className="font-mono text-gray-300">
            {result.diodes.map(d => (
              <tr key={d.diodeId} className="border-b border-gray-800/60">
                <td className="py-1.5 pr-3">{d.diodeId}</td>
                <td className="py-1.5 pr-3">{d.fit.slope.toExponential(3)}</td>
                <td className="py-1.5 pr-3">{d.fit.intercept.toFixed(4)}</td>
                <td className="py-1.5 pr-3">{d.fit.rSquared.toFixed(4)}</td>
                <td className="py-1.5 pr-3">{d.extrapolatedVd.toFixed(4)}</td>
                <td className="py-1.5 pr-3"><VerdictPill verdict={d.verdict} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
