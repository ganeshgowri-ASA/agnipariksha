/**
 * IR thermography heatmap helpers — IEC TS 60904-12.
 *
 * Builds on the merged forward-bias thermography work (#137): given a
 * 2-D per-pixel temperature grid (row-major rows × cols), derive the
 * inputs a temperature-distribution view needs — grid statistics, the
 * hot-spot cell mask, a histogram for the distribution chart, and the
 * color-scale mapping for the heatmap render.
 *
 * Pure functions — no React, no I/O. Tested under vitest in
 * heatmap.test.ts. The math is mirrored on the backend in
 * backend/test_programs/ir_thermography.py so the bench and the
 * dashboard report the same distribution; update both files together.
 */

/** A 2-D, row-major temperature grid (°C). `grid[r][c]`. */
export type TempGrid = readonly (readonly number[])[];

/** IEC TS 60904-12 thresholds encoded so the heatmap can cite the source. */
export const HEATMAP_CONSTANTS = {
  /**
   * Default hot-spot delta-T over the grid mean (°C). IEC TS 60904-12
   * flags cells significantly warmer than the module average under
   * forward bias; 10 °C is the common operator default also used by the
   * existing IIR verdict bands (DELTA_T_PASS).
   */
  HOTSPOT_DELTA_T_C: 10,
  /** Default histogram bin count for the temperature distribution. */
  DEFAULT_BINS: 16,
} as const;

export interface GridStats {
  /** Coldest cell (°C). 0 for an empty grid. */
  min: number;
  /** Hottest cell (°C). 0 for an empty grid. */
  max: number;
  /** Arithmetic mean across all cells (°C). 0 for an empty grid. */
  mean: number;
  /** Population standard deviation across all cells (°C). */
  std: number;
  /** Total number of cells counted. */
  count: number;
}

export interface HotspotCell {
  row: number;
  col: number;
  /** Absolute temperature (°C). */
  temp: number;
  /** Temperature above the grid mean (°C). */
  deltaT: number;
}

export interface HistogramBin {
  /** Inclusive lower edge of the bin (°C). */
  start: number;
  /** Exclusive upper edge of the bin (°C) — except the last bin, which is inclusive. */
  end: number;
  /** Number of cells whose temperature falls in [start, end). */
  count: number;
}

/** Flatten a row-major grid into a single array of cell temperatures. */
function flatten(grid: TempGrid): number[] {
  const out: number[] = [];
  for (const row of grid) {
    for (const t of row) out.push(t);
  }
  return out;
}

/**
 * Min / max / mean / population-std over every cell of the grid.
 * Returns all-zero stats for an empty grid so callers stay branch-free.
 */
export function gridStats(grid: TempGrid): GridStats {
  const values = flatten(grid);
  const count = values.length;
  if (count === 0) {
    return { min: 0, max: 0, mean: 0, std: 0, count: 0 };
  }

  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const t of values) {
    if (t < min) min = t;
    if (t > max) max = t;
    sum += t;
  }
  const mean = sum / count;

  let sqAcc = 0;
  for (const t of values) {
    const d = t - mean;
    sqAcc += d * d;
  }
  const std = Math.sqrt(sqAcc / count);

  return { min, max, mean, std, count };
}

/**
 * Cells whose temperature exceeds (grid mean + deltaT). Defaults to the
 * IEC TS 60904-12 hot-spot threshold. Returned sorted hottest-first so
 * the UI can show the worst cells without re-sorting.
 */
export function hotspotCells(
  grid: TempGrid,
  deltaT: number = HEATMAP_CONSTANTS.HOTSPOT_DELTA_T_C,
): HotspotCell[] {
  const { mean } = gridStats(grid);
  const out: HotspotCell[] = [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    for (let c = 0; c < row.length; c++) {
      const dT = row[c] - mean;
      if (dT > deltaT) {
        out.push({ row: r, col: c, temp: row[c], deltaT: dT });
      }
    }
  }
  out.sort((a, b) => b.deltaT - a.deltaT);
  return out;
}

/**
 * Partition the grid temperatures into `bins` equal-width buckets across
 * [min, max]. The bin counts always sum to the cell count. A degenerate
 * grid (all cells equal, so min === max) collapses to a single populated
 * bin. `bins` is clamped to >= 1.
 */
export function histogram(
  grid: TempGrid,
  bins: number = HEATMAP_CONSTANTS.DEFAULT_BINS,
): HistogramBin[] {
  const values = flatten(grid);
  const n = Math.max(1, Math.floor(bins));
  const { min, max } = gridStats(grid);

  if (values.length === 0) {
    return [];
  }

  // All-equal grid → one bin holding every cell.
  if (max === min) {
    return [{ start: min, end: max, count: values.length }];
  }

  const width = (max - min) / n;
  const out: HistogramBin[] = Array.from({ length: n }, (_, i) => ({
    start: min + i * width,
    end: i === n - 1 ? max : min + (i + 1) * width,
    count: 0,
  }));

  for (const t of values) {
    // Clamp index so the max value lands in the last bin (right edge is inclusive there).
    let idx = Math.floor((t - min) / width);
    if (idx >= n) idx = n - 1;
    if (idx < 0) idx = 0;
    out[idx].count += 1;
  }

  return out;
}

/**
 * Map a temperature to a normalized position in [0, 1] across [min, max].
 * Used to drive the heatmap color scale (a jet-style colormap lives in
 * the tab). Values outside the range clamp to the ends; a zero-width
 * range maps to 0.
 */
export function colorScale(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  const t = (value - min) / (max - min);
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}
