/**
 * Inverted IR (forward-bias thermography) analysis — IEC TS 60904-12.
 *
 * Standard procedure: pass forward bias current (≈Isc) through an
 * unilluminated module and image with a thermal camera. Hot spots
 * indicate shunting/defects. Verdict thresholds vary by cell tech;
 * common operator defaults:
 *   - Max ΔT vs module median ≤ 10 °C → PASS
 *   - 10-20 °C → WARN (operator review)
 *   - > 20 °C → FAIL (hot-spot)
 *
 * Same panel/verdict pattern as the other IEC tabs. Pure functions —
 * the InvertedIRTab.tsx component generates the thermogram and calls
 * computeIirKpis(); this module ships the math + tests.
 */

export type Verdict = 'pass' | 'warn' | 'fail' | 'pending';

export const IIR_CONSTANTS = {
  /** Pass threshold for max ΔT above module median (°C). */
  DELTA_T_PASS: 10,
  /** Warn band — operator-review zone (°C). */
  DELTA_T_WARN: 20,
  /** Per-cell ΔT classification for the hot-spot table. */
  HOTSPOT_DEFAULT_C: 10,
} as const;

export interface IirConfig {
  /** Operator-set hot-spot threshold (°C) — used for the table. */
  threshold: number;
  /** Forward injection current (A) at capture. */
  forwardCurrent: number;
}

export interface HotSpot {
  /** Row-major index in the temperature grid. */
  idx: number;
  row: number;
  col: number;
  /** Absolute temperature (°C). */
  temp: number;
  /** Temperature above module median (°C). */
  deltaT: number;
}

export interface IirKpis {
  /** Module-wide median temperature (°C). */
  tMedian: number;
  /** Module max temperature (°C). */
  tMax: number;
  /** Module min temperature (°C). */
  tMin: number;
  /** Largest single-cell ΔT above median. */
  maxDeltaT: number;
  /** Cells flagged above operator threshold. */
  hotSpots: HotSpot[];
  /** Total cells > 5 °C above median (info — not a verdict). */
  warmCells: number;
  hotspotVerdict: Verdict;
  /** Composite — pending if temps array is empty. */
  overallVerdict: Verdict;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function classifyHotspot(maxDelta: number): Verdict {
  if (maxDelta <= IIR_CONSTANTS.DELTA_T_PASS) return 'pass';
  if (maxDelta <= IIR_CONSTANTS.DELTA_T_WARN) return 'warn';
  return 'fail';
}

export function computeIirKpis(
  temps: readonly number[],
  cols: number,
  cfg: IirConfig,
): IirKpis {
  if (temps.length === 0) {
    return {
      tMedian: 0, tMax: 0, tMin: 0,
      maxDeltaT: 0,
      hotSpots: [], warmCells: 0,
      hotspotVerdict: 'pending',
      overallVerdict: 'pending',
    };
  }

  const tMedian = median(temps as number[]);
  let tMax = -Infinity;
  let tMin = Infinity;
  let warmCells = 0;
  const hotSpots: HotSpot[] = [];

  for (let i = 0; i < temps.length; i++) {
    const t = temps[i];
    if (t > tMax) tMax = t;
    if (t < tMin) tMin = t;
    const dT = t - tMedian;
    if (dT > 5) warmCells += 1;
    if (dT > cfg.threshold) {
      hotSpots.push({
        idx: i,
        col: i % cols,
        row: Math.floor(i / cols),
        temp: t,
        deltaT: dT,
      });
    }
  }
  hotSpots.sort((a, b) => b.deltaT - a.deltaT);

  const maxDeltaT = tMax - tMedian;
  const hotspotVerdict = classifyHotspot(maxDeltaT);

  return {
    tMedian, tMax, tMin,
    maxDeltaT,
    hotSpots, warmCells,
    hotspotVerdict,
    overallVerdict: hotspotVerdict,
  };
}
