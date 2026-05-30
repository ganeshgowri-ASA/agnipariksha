/**
 * Inverted IR Analysis pane — IEC TS 60904-12.
 *
 * Drop-in replacement for the inline analysisPane in InvertedIRTab.tsx
 * so the math is testable in vitest and the verdict mapping matches
 * the standard's clauses precisely. Hot-spot table + verdict pill +
 * KPI strip in the same visual language as TC/HF/RCO/PID/EL panels.
 *
 * PR (#137 follow-up) adds the temperature-distribution view: a heatmap
 * of the thermogram grid + a histogram of the per-pixel temperatures
 * (both driven by the vitest-covered heatmap helpers) and a metadata
 * block (camera / current / PSU settings) that is also surfaced for the
 * report.
 */
'use client';

import { useMemo } from 'react';
import {
  computeIirKpis, IIR_CONSTANTS,
  type Verdict, type IirConfig, type IirKpis,
} from './iirAnalysis';
import {
  gridStats, histogram, colorScale, HEATMAP_CONSTANTS,
  type TempGrid, type HistogramBin,
} from './heatmap';

/**
 * Camera / current / PSU settings captured at thermogram time — shown on
 * the analysis view and carried into the IEC TS 60904-12 report. PSU
 * fields here are displayed metadata only (no device control).
 */
export interface IirMetadata {
  /** IR camera model. */
  camera: string;
  /** Camera emissivity setting (0–1). */
  emissivity: number;
  /** Ambient temperature at capture (°C). */
  ambientC: number;
  /** Forward injection current setpoint (A, ≈Isc). */
  forwardCurrent: number;
  /** Soak time before capture (s). */
  soakTimeS: number;
  /** PSU output voltage at capture (V). */
  psuVoltage: number;
  /** PSU current limit / compliance (A). */
  psuCurrentLimit: number;
}

interface Props {
  /** Thermogram temperatures (row-major, °C). */
  temps: readonly number[];
  /** Image columns (used to decode hotspot coords + build the grid). */
  cols: number;
  /** Image rows (display only). */
  rows: number;
  /** Operator-set hot-spot threshold ΔT (°C). */
  threshold: number;
  /** Forward injection current (A). */
  forwardCurrent: number;
  /** Camera / current / PSU metadata (optional — omit to hide the block). */
  metadata?: IirMetadata;
}

// Jet-like colormap: t in [0,1] → CSS rgb(). Same scale as the tab's
// Live Monitor thermogram so the analysis heatmap reads identically.
function jet(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const r = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 3)));
  const g = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 2)));
  const b = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 1)));
  return `rgb(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0})`;
}

/** Reshape a flat row-major temperature array into a 2-D grid. */
function toGrid(temps: readonly number[], cols: number): TempGrid {
  if (cols <= 0) return [];
  const out: number[][] = [];
  for (let i = 0; i < temps.length; i += cols) {
    out.push(temps.slice(i, i + cols) as number[]);
  }
  return out;
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

/** Heatmap of the thermogram grid (CSS grid of color-scaled cells). */
function HeatmapView({ grid, min, max, rows, cols }: { grid: TempGrid; min: number; max: number; rows: number; cols: number }) {
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4" data-testid="iir-heatmap">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-200">Temperature distribution — heatmap ({cols}×{rows})</h3>
        <span className="text-[10px] text-gray-500 font-mono">IEC TS 60904-12</span>
      </div>
      <div
        className="grid gap-px w-full max-w-3xl"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {grid.flatMap((row, r) =>
          row.map((t, c) => (
            <div key={`${r}-${c}`} className="aspect-square" style={{ background: jet(colorScale(t, min, max)) }} />
          )),
        )}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <span className="text-[10px] text-gray-400 font-mono">{min.toFixed(1)} °C</span>
        <div className="flex-1 h-3 rounded" style={{
          background: `linear-gradient(to right, ${jet(0)}, ${jet(0.25)}, ${jet(0.5)}, ${jet(0.75)}, ${jet(1)})`,
        }} data-testid="iir-heatmap-legend" />
        <span className="text-[10px] text-gray-400 font-mono">{max.toFixed(1)} °C</span>
      </div>
    </div>
  );
}

/** Histogram of the per-pixel temperatures (the distribution chart). */
function DistributionChart({ bins }: { bins: HistogramBin[] }) {
  const peak = bins.reduce((m, b) => Math.max(m, b.count), 0) || 1;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4" data-testid="iir-distribution">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-200">Temperature histogram</h3>
        <span className="text-[10px] text-gray-500 font-mono">{HEATMAP_CONSTANTS.DEFAULT_BINS} bins</span>
      </div>
      <div className="flex items-end gap-1 h-32">
        {bins.map((b, i) => (
          <div
            key={i}
            className="flex-1 bg-pink-500/60 hover:bg-pink-400/80 rounded-t"
            style={{ height: `${(b.count / peak) * 100}%` }}
            title={`${b.start.toFixed(1)}–${b.end.toFixed(1)} °C · ${b.count} cells`}
            data-testid="iir-hist-bar"
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-gray-500 font-mono mt-1">
        <span>{bins.length ? bins[0].start.toFixed(1) : '0'} °C</span>
        <span>{bins.length ? bins[bins.length - 1].end.toFixed(1) : '0'} °C</span>
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-1 border-t border-gray-800 first:border-t-0">
      <span className="text-gray-500">{label}</span>
      <span className="font-mono text-gray-200">{value}</span>
    </div>
  );
}

/** Camera / current / PSU metadata block — also carried into the report. */
function MetadataBlock({ meta }: { meta: IirMetadata }) {
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4" data-testid="iir-metadata">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-200">Capture metadata</h3>
        <span className="text-[10px] text-gray-500 font-mono">IEC TS 60904-12 · §6</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 text-xs">
        <div data-testid="iir-meta-camera">
          <p className="text-[10px] uppercase tracking-wider text-pink-400/80 mb-1">Camera</p>
          <MetaRow label="Model" value={meta.camera} />
          <MetaRow label="Emissivity" value={meta.emissivity.toFixed(2)} />
          <MetaRow label="Ambient" value={`${meta.ambientC.toFixed(1)} °C`} />
        </div>
        <div data-testid="iir-meta-current">
          <p className="text-[10px] uppercase tracking-wider text-pink-400/80 mb-1">Current</p>
          <MetaRow label="Forward bias" value={`${meta.forwardCurrent.toFixed(2)} A`} />
          <MetaRow label="Soak time" value={`${meta.soakTimeS.toFixed(0)} s`} />
        </div>
        <div data-testid="iir-meta-psu">
          <p className="text-[10px] uppercase tracking-wider text-pink-400/80 mb-1">PSU</p>
          <MetaRow label="Voltage" value={`${meta.psuVoltage.toFixed(2)} V`} />
          <MetaRow label="Current limit" value={`${meta.psuCurrentLimit.toFixed(2)} A`} />
        </div>
      </div>
    </div>
  );
}

export default function IirAnalysisPanel({ temps, cols, rows, threshold, forwardCurrent, metadata }: Props) {
  const cfg: IirConfig = useMemo(() => ({ threshold, forwardCurrent }), [threshold, forwardCurrent]);
  const kpis = useMemo(() => computeIirKpis(temps, cols, cfg), [temps, cols, cfg]);
  const grid = useMemo(() => toGrid(temps, cols), [temps, cols]);
  const stats = useMemo(() => gridStats(grid), [grid]);
  const bins = useMemo(() => histogram(grid, HEATMAP_CONSTANTS.DEFAULT_BINS), [grid]);

  if (temps.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
        <p className="text-sm text-gray-400">
          No thermogram captured yet. Capture a frame in Live Monitor — KPIs,
          the temperature-distribution heatmap + histogram, and the hot-spot
          table populate here.
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

      {metadata && <MetadataBlock meta={metadata} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HeatmapView grid={grid} min={stats.min} max={stats.max} rows={rows} cols={cols} />
        <DistributionChart bins={bins} />
      </div>

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
