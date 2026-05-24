/**
 * Bypass-diode (BDT) analysis helpers for IEC 61215-2 MQT 18.1.
 *
 * MQT 18.1 characterises each bypass diode by sweeping junction temperature
 * T_j and recording the forward voltage drop V_drop. A linear fit
 * (V_drop = m·T_j + b) is extrapolated to the recipe's Tjmax to judge
 * whether the diode stays inside a safe forward-drop band.
 *
 * The recipe types below are the *minimum* shape this module needs. P2 of
 * the prompt pack introduces the full recipe model; until it merges these
 * inline definitions keep this PR self-contained.
 */

export type BdtMode = 'IEC 62979' | 'MQT 18.1';

export interface BdtRecipeMin {
  mode: BdtMode;
  /** Maximum junction temperature the fit is extrapolated to (°C). */
  Tjmax: number;
}

/** A single measured (T_j, V_drop) sample for one diode. */
export interface VdTjPoint {
  /** Junction temperature, °C. */
  tj: number;
  /** Forward voltage drop, V. */
  vdrop: number;
}

export interface DiodeMeasurement {
  diodeId: string;
  points: VdTjPoint[];
}

export interface LinearFit {
  /** Slope m, in V/°C. */
  slope: number;
  /** Intercept b, in V. */
  intercept: number;
  /** Coefficient of determination, 0..1. */
  rSquared: number;
}

export type Verdict = 'PASS' | 'REVIEW' | 'FAIL';

/** Default safe band for the extrapolated forward drop at Tjmax, in volts. */
export const SAFE_VD_BAND_V = 0.6;

const R2_PASS = 0.85;
const R2_FAIL = 0.5;

/**
 * Ordinary least-squares linear fit of y = slope·x + intercept.
 * Returns NaN-free zeros for degenerate input (fewer than 2 points or a
 * vertical/zero-variance x), with rSquared = 0.
 */
export function linearRegression(points: VdTjPoint[]): LinearFit {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: n === 1 ? points[0].vdrop : 0, rSquared: 0 };

  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of points) {
    sx += p.tj;
    sy += p.vdrop;
    sxx += p.tj * p.tj;
    sxy += p.tj * p.vdrop;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return { slope: 0, intercept: sy / n, rSquared: 0 };

  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;

  const meanY = sy / n;
  let ssTot = 0, ssRes = 0;
  for (const p of points) {
    const yhat = slope * p.tj + intercept;
    ssTot += (p.vdrop - meanY) ** 2;
    ssRes += (p.vdrop - yhat) ** 2;
  }
  const rSquared = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { slope, intercept, rSquared };
}

/** Extrapolated forward drop at Tjmax, in volts. */
export function extrapolateVdrop(fit: LinearFit, tjmax: number): number {
  return fit.slope * tjmax + fit.intercept;
}

/**
 * Per-diode verdict:
 *  - PASS:   R² ≥ 0.85 AND |V_drop(Tjmax)| within the safe band
 *  - FAIL:   R² < 0.5
 *  - REVIEW: otherwise (0.5 ≤ R² < 0.85, or out-of-band with good R²)
 */
export function diodeVerdict(
  rSquared: number,
  extrapolatedVd: number,
  safeBand: number = SAFE_VD_BAND_V,
): Verdict {
  if (rSquared < R2_FAIL) return 'FAIL';
  const withinBand = Math.abs(extrapolatedVd) <= safeBand;
  if (rSquared >= R2_PASS && withinBand) return 'PASS';
  return 'REVIEW';
}

/** Roll diode verdicts up to a module verdict (worst-case wins). */
export function moduleVerdict(verdicts: Verdict[]): Verdict {
  if (verdicts.some(v => v === 'FAIL')) return 'FAIL';
  if (verdicts.some(v => v === 'REVIEW')) return 'REVIEW';
  return 'PASS';
}

export interface DiodeAnalysis {
  diodeId: string;
  points: VdTjPoint[];
  fit: LinearFit;
  extrapolatedVd: number;
  verdict: Verdict;
}

/** Analyse every diode against the recipe and return per-diode + module results. */
export function analyseDiodes(
  diodes: DiodeMeasurement[],
  tjmax: number,
  safeBand: number = SAFE_VD_BAND_V,
): { diodes: DiodeAnalysis[]; module: Verdict } {
  const analysed = diodes.map<DiodeAnalysis>(d => {
    const fit = linearRegression(d.points);
    const extrapolatedVd = extrapolateVdrop(fit, tjmax);
    return {
      diodeId: d.diodeId,
      points: d.points,
      fit,
      extrapolatedVd,
      verdict: diodeVerdict(fit.rSquared, extrapolatedVd, safeBand),
    };
  });
  return { diodes: analysed, module: moduleVerdict(analysed.map(d => d.verdict)) };
}
