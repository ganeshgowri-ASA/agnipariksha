/**
 * IEC 61215-2 MQT 18.1 — Step 1: V_D-versus-T_j characteristic.
 *
 * Pure OLS helpers for the per-diode bypass-diode regression used by the
 * Mitsui R.MQT18.1v01 evaluation template (WAAREE-770). Each diode is
 * characterised by measuring its forward voltage drop V_D at several junction
 * temperatures, fitting V_D = m·T_j + b, and extrapolating to the diode's
 * maximum rated junction temperature T_jmax.
 *
 * No React / DOM here — kept framework-free so it is unit-testable in isolation.
 */

/** A single calibration point: forward voltage drop measured at a junction temp. */
export interface DiodePoint {
  /** Junction temperature T_j, °C. */
  tjc: number;
  /** Forward voltage drop V_D, V. */
  vdropv: number;
}

/** Result of an ordinary least-squares fit of V_D against T_j. */
export interface LinearFit {
  /** Slope m of V_D = m·T_j + b, in V/°C. */
  slope: number;
  /** Intercept b (extrapolated V_D at 0 °C), in V. */
  intercept: number;
  /** Coefficient of determination R². */
  r2: number;
  /** Number of points used in the fit. */
  n: number;
}

export type Verdict = 'PASS' | 'REVIEW' | 'FAIL';

/** Per-diode judgement: the fit, the extrapolated drop, and a PASS/REVIEW/FAIL call. */
export interface DiodeJudgement {
  diodeId: string;
  fit: LinearFit;
  /** V_D extrapolated to T_jmax, V. */
  vAtTjmaxV: number;
  verdict: Verdict;
  reason: string;
}

/** One diode's series as consumed by the analysis panel. */
export interface DiodeSeries {
  diodeId: string;
  /** Maximum rated junction temperature T_jmax, °C (from the diode datasheet). */
  tjmaxc: number;
  points: DiodePoint[];
}

const R2_FAIL = 0.5;
const R2_REVIEW = 0.85;

/** Ordinary least-squares fit of V_D (y) against T_j (x). */
export function linearFit(points: { tjc: number; vdropv: number }[]): LinearFit {
  const n = points.length;
  if (n === 0) return { slope: 0, intercept: 0, r2: 0, n: 0 };

  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.tjc;
    sumY += p.vdropv;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    const dx = p.tjc - meanX;
    const dy = p.vdropv - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }

  // A slope needs ≥2 points spread over ≥2 distinct temperatures.
  if (n < 2 || sxx === 0) {
    return { slope: 0, intercept: meanY, r2: 0, n };
  }

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  // Flat data (syy === 0) is fit exactly by the horizontal line through its mean.
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2, n };
}

/** Evaluate the fitted line at temperature `tc` (°C). */
export function extrapolateVAtT(fit: LinearFit, tc: number): number {
  return fit.slope * tc + fit.intercept;
}

/**
 * Judge a single diode from its V_D/T_j points.
 *   FAIL   when R² < 0.5 — no usable linear characteristic.
 *   REVIEW when 0.5 ≤ R² < 0.85, or |V_D(T_jmax)| falls outside the safe band.
 *   PASS   otherwise.
 */
export function judgeDiode(
  diodeId: string,
  points: { tjc: number; vdropv: number }[],
  tjmaxc: number,
  safeVdBandV = 0.6,
): DiodeJudgement {
  const fit = linearFit(points);
  const vAtTjmaxV = extrapolateVAtT(fit, tjmaxc);
  const absV = Math.abs(vAtTjmaxV);

  let verdict: Verdict;
  let reason: string;
  if (fit.r2 < R2_FAIL) {
    verdict = 'FAIL';
    reason = `R²=${fit.r2.toFixed(3)} < ${R2_FAIL} — no usable V_D–T_j characteristic (n=${fit.n}).`;
  } else if (fit.r2 < R2_REVIEW || absV > safeVdBandV) {
    verdict = 'REVIEW';
    const why: string[] = [];
    if (fit.r2 < R2_REVIEW) why.push(`R²=${fit.r2.toFixed(3)} in [${R2_FAIL}, ${R2_REVIEW})`);
    if (absV > safeVdBandV) why.push(`|V_D(T_jmax)|=${absV.toFixed(3)} V > ${safeVdBandV} V band`);
    reason = `${why.join('; ')}.`;
  } else {
    verdict = 'PASS';
    reason = `R²=${fit.r2.toFixed(3)} ≥ ${R2_REVIEW}; V_D(T_jmax)=${vAtTjmaxV.toFixed(3)} V within ±${safeVdBandV} V.`;
  }
  return { diodeId, fit, vAtTjmaxV, verdict, reason };
}

const RANK: Record<Verdict, number> = { PASS: 0, REVIEW: 1, FAIL: 2 };

/** Module verdict is the worst (highest-severity) of all per-diode verdicts. */
export function judgeModule(perDiode: { verdict: Verdict }[]): Verdict {
  let worst: Verdict = 'PASS';
  for (const d of perDiode) {
    if (RANK[d.verdict] > RANK[worst]) worst = d.verdict;
  }
  return worst;
}
