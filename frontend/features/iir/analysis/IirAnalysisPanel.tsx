/**
 * Inverted IR Analysis pane — IEC TS 60904-12.
 *
 * Drop-in replacement for the inline analysisPane in InvertedIRTab.tsx
 * so the math is testable in vitest and the verdict mapping matches
 * the standard's clauses precisely. Hot-spot table + verdict pill +
 * KPI strip in the same visual language as TC/HF/RCO/PID/EL panels.
 */
'use client';

import { useMemo } from 'react';
import {
  computeIirKpis, IIR_CONSTANTS,
  type Verdict, type IirConfig, type IirKpis,
} from './iirAnalysis';

interface Props {
  /** Thermogram temperatures (row-major, °C). */
  temps: readonly number[];
  /** Image columns (used to decode hotspot coords). */
  cols: number;
  /** Image rows (display only). */
  rows: number;
  /** Operator-set hot-spot threshold ΔT (°C). */
  threshold: number;
  /** Forward injection current (A). */
  forwardCurrent: number;
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

function HotspotPill({ kpis }: { kpis: IirKpis }) {
  const c = verdictColors(kpis.hotspotVerdict);
  const label =
    kpis.hotspotVerdict === 'pending' ? 'No thermogram'
    : kpis.hotspotVerdict === 'pass'  ? `PASS — max ΔT ${kpis.maxDeltaT.toFixed(1)} °C ≤ ${IIR_CONSTANTS.DELTA_T_PASS}`
    : kpis.hotspotVerdict === 'warn'  ? `WARN — max ΔT ${kpis.maxDeltaT.toFixed(1)} °C (review hotspots)`
    : `FAIL — max ΔT ${kpis.maxDeltaT.toFixed(1)} °C > ${IIR_CONSTANTS.DELTA_T_WARN}`;
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${c.bg} ring-1 ${c.ring} ${c.text} text-xs font-medium`}>
      <span className="font-mono">TS 60904-12</span>
      <span>{label}</span>
    </div>
  );
}

export default function IirAnalysisPanel({ temps, cols, threshold, forwardCurrent }: Props) {
  const cfg: IirConfig = useMemo(() => ({ threshold, forwardCurrent }), [threshold, forwardCurrent]);
  const kpis = useMemo(() => computeIirKpis(temps, cols, cfg), [temps, cols, cfg]);

  if (temps.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
        <p className="text-sm text-gray-400">
          No thermogram captured yet. Capture a frame in Live Monitor — KPIs
          and the hot-spot table populate here.
        </p>
        <p className="text-xs text-gray-500 mt-3">
          IEC TS 60904-12 · forward-bias {forwardCurrent.toFixed(1)} A · operator threshold {threshold} °C
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Module median" value={`${kpis.tMedian.toFixed(1)} °C`} sub={`min ${kpis.tMin.toFixed(1)} / max ${kpis.tMax.toFixed(1)}`} />
        <KpiCard label="Max ΔT" value={`+${kpis.maxDeltaT.toFixed(1)} °C`} sub={`vs median`} />
        <KpiCard label="Hot spots" value={`${kpis.hotSpots.length}`} sub={`> ${threshold} °C threshold`} />
        <KpiCard label="Warm cells" value={`${kpis.warmCells}`} sub={`> +5 °C above median`} />
      </div>

      <HotspotPill kpis={kpis} />

      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-200">Flagged cells</h3>
          <span className="text-[10px] text-gray-500 font-mono">IEC TS 60904-12</span>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 text-left">
              <th className="py-1">Row</th><th>Col</th><th>Temp (°C)</th><th>ΔT vs median (°C)</th>
            </tr>
          </thead>
          <tbody className="font-mono text-gray-200">
            {kpis.hotSpots.slice(0, 30).map(h => (
              <tr key={h.idx} className="border-t border-gray-800">
                <td className="py-1">{h.row}</td>
                <td>{h.col}</td>
                <td>{h.temp.toFixed(1)}</td>
                <td className={h.deltaT > IIR_CONSTANTS.DELTA_T_WARN ? 'text-red-400' : h.deltaT > IIR_CONSTANTS.DELTA_T_PASS ? 'text-amber-400' : 'text-pink-400'}>+{h.deltaT.toFixed(1)}</td>
              </tr>
            ))}
            {kpis.hotSpots.length === 0 && (
              <tr><td colSpan={4} className="py-3 text-gray-500 text-center">
                No cells exceed ΔT {threshold} °C — module looks healthy.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
