/**
 * EL (Electroluminescence) analysis — IEC TS 60904-13.
 *
 * IEC TS 60904-13 specifies forward-bias EL imaging for crystalline-Si
 * modules. Pass criteria are qualitative on the image itself, but
 * quantitative anchors operators look at:
 *
 *   - Inactive cell count (cells with mean intensity < threshold% of
 *     module-wide mean)
 *   - Mean intensity (proxy for module health vs baseline)
 *   - Hotspot/defect indicator (cell standard deviation above warn band)
 *   - Crack indicator (per-cell intensity gradient above threshold)
 *
 * Module is treated as a `cellsX × cellsY` grid. Each cell carries a
 * normalised intensity in [0, 1]. The analyzer never imports React or
 * the camera SDK so it tests cleanly in vitest.
 */

export type Verdict = 'pass' | 'warn' | 'fail' | 'pending';

export const EL_CONSTANTS = {
  /** Cells below this fraction of the module mean are "inactive". */
  INACTIVE_THRESHOLD: 0.30,
  /** Per-cell std-dev above this is flagged as a possible defect/crack. */
  DEFECT_STDEV: 0.18,
  /** Module-wide minimum mean intensity for PASS. */
  MEAN_INTENSITY_MIN: 0.45,
  /** Maximum allowed inactive cells (per IEC TS 60904-13 guidance — typ. ≤2%). */
  MAX_INACTIVE_PCT: 2.0,
  /** Warn band — 2-5% inactive flags amber, >5% fails. */
  WARN_INACTIVE_PCT: 5.0,
} as const;

export interface ElFrame {
  /** Module grid width in cells. */
  cellsX: number;
  /** Module grid height in cells. */
  cellsY: number;
  /** Row-major intensity grid, length = cellsX × cellsY. Values in [0, 1]. */
  intensities: number[];
  /** Operator-set forward-bias injection current at capture (A). */
  injectionCurrent: number;
  /** Camera exposure (s). */
  exposureSec: number;
  /** Capture timestamp (ms). */
  capturedAtMs: number;
}

export interface ElKpis {
  meanIntensity: number;
  stdDev: number;
  inactiveCells: number;
  inactivePct: number;
  defectCells: number;
  defectPct: number;
  /** Indices of inactive cells (row-major). */
  inactiveIdx: number[];
  /** Indices of defect cells. */
  defectIdx: number[];
  meanIntensityVerdict: Verdict;
  inactiveVerdict: Verdict;
  defectVerdict: Verdict;
  overallVerdict: Verdict;
}

function classifyMean(mean: number): Verdict {
  if (mean >= EL_CONSTANTS.MEAN_INTENSITY_MIN) return 'pass';
  if (mean >= EL_CONSTANTS.MEAN_INTENSITY_MIN * 0.8) return 'warn';
  return 'fail';
}

function classifyInactive(pct: number): Verdict {
  if (pct <= EL_CONSTANTS.MAX_INACTIVE_PCT) return 'pass';
  if (pct <= EL_CONSTANTS.WARN_INACTIVE_PCT) return 'warn';
  return 'fail';
}

function classifyDefect(pct: number): Verdict {
  if (pct <= 3.0) return 'pass';
  if (pct <= 8.0) return 'warn';
  return 'fail';
}

export function computeElKpis(frame: ElFrame | null): ElKpis {
  if (frame === null || frame.intensities.length === 0) {
    return {
      meanIntensity: 0, stdDev: 0,
      inactiveCells: 0, inactivePct: 0,
      defectCells: 0, defectPct: 0,
      inactiveIdx: [], defectIdx: [],
      meanIntensityVerdict: 'pending',
      inactiveVerdict: 'pending',
      defectVerdict: 'pending',
      overallVerdict: 'pending',
    };
  }

  const N = frame.intensities.length;
  let sum = 0;
  for (const v of frame.intensities) sum += v;
  const meanIntensity = sum / N;

  let varSum = 0;
  for (const v of frame.intensities) varSum += (v - meanIntensity) ** 2;
  const stdDev = Math.sqrt(varSum / N);

  // Inactive: cells well below module mean.
  const inactiveIdx: number[] = [];
  const cutoff = meanIntensity * EL_CONSTANTS.INACTIVE_THRESHOLD;
  for (let i = 0; i < N; i++) {
    if (frame.intensities[i] < cutoff) inactiveIdx.push(i);
  }

  // Defects: cells with high local gradient (neighbour |Δ| above STDEV).
  const defectIdx: number[] = [];
  const w = frame.cellsX;
  for (let y = 0; y < frame.cellsY; y++) {
    for (let x = 0; x < frame.cellsX; x++) {
      const i = y * w + x;
      const v = frame.intensities[i];
      // Look at right + down neighbour
      const r = x + 1 < frame.cellsX ? frame.intensities[i + 1] : v;
      const d = y + 1 < frame.cellsY ? frame.intensities[i + w] : v;
      const grad = Math.max(Math.abs(v - r), Math.abs(v - d));
      if (grad > EL_CONSTANTS.DEFECT_STDEV) defectIdx.push(i);
    }
  }

  const inactivePct = (inactiveIdx.length / N) * 100;
  const defectPct = (defectIdx.length / N) * 100;

  const meanIntensityVerdict = classifyMean(meanIntensity);
  const inactiveVerdict = classifyInactive(inactivePct);
  const defectVerdict = classifyDefect(defectPct);

  let overallVerdict: Verdict = 'pending';
  const all = [meanIntensityVerdict, inactiveVerdict, defectVerdict];
  if (all.some((v) => v === 'fail')) overallVerdict = 'fail';
  else if (all.some((v) => v === 'warn')) overallVerdict = 'warn';
  else if (all.every((v) => v === 'pass')) overallVerdict = 'pass';

  return {
    meanIntensity, stdDev,
    inactiveCells: inactiveIdx.length, inactivePct,
    defectCells: defectIdx.length, defectPct,
    inactiveIdx, defectIdx,
    meanIntensityVerdict, inactiveVerdict, defectVerdict,
    overallVerdict,
  };
}

/**
 * Deterministic DEMO frame generator — produces a realistic 6×10
 * crystalline-Si module pattern with a couple of synthetic defects
 * so reviewers see meaningful KPIs even without a camera attached.
 *
 * The generator is keyed on the operator's `injectionCurrent` so
 * different setpoints yield visibly different frames.
 */
export function generateDemoFrame(
  cellsX: number, cellsY: number, injectionCurrent: number,
): ElFrame {
  // Mulberry32 PRNG seeded by injection current so a given setpoint
  // is reproducible.
  let s = Math.floor(injectionCurrent * 1000);
  const rand = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const N = cellsX * cellsY;
  const intensities = new Array<number>(N);
  // Base intensity proportional to injection current (saturating at I=10A).
  const baseMean = Math.min(0.85, injectionCurrent / 10 * 0.75);
  for (let i = 0; i < N; i++) {
    intensities[i] = baseMean + (rand() - 0.5) * 0.10;
  }
  // Inject two inactive cells at deterministic positions.
  const inactiveCount = Math.max(1, Math.floor(N * 0.02));
  for (let k = 0; k < inactiveCount; k++) {
    const idx = Math.floor(rand() * N);
    intensities[idx] = 0.05 + rand() * 0.05;
  }
  // One stripe defect (interconnect fault — a low-intensity row segment).
  const stripeRow = Math.floor(cellsY * 0.6);
  for (let x = 0; x < Math.min(3, cellsX); x++) {
    intensities[stripeRow * cellsX + x] = 0.18;
  }
  // Clamp to [0,1].
  for (let i = 0; i < N; i++) {
    intensities[i] = Math.max(0, Math.min(1, intensities[i]));
  }

  return {
    cellsX, cellsY,
    intensities,
    injectionCurrent,
    exposureSec: 10,
    capturedAtMs: 0,
  };
}
