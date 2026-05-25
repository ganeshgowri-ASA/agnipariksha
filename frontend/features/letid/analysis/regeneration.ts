/**
 * IEC TS 63342 — LeTID dark V_oc regeneration analysis.
 *
 * Light- and elevated-Temperature-Induced Degradation is tracked through the
 * module's dark open-circuit voltage over exposure hours. The shape is: an
 * initial degradation phase (V_oc falls), a regeneration onset (the local
 * minimum), and recovery to a plateau. These pure helpers smooth the noisy
 * series, locate the onset, evaluate the plateau stop criterion, and render an
 * overall verdict. No React / DOM — framework-free so it is unit-testable.
 */

/** One exposure sample: dark open-circuit voltage (V) at a number of hours. */
export interface LetidPoint {
  hours: number;
  darkVoc: number;
}

/** A smoothed sample from {@link movingAverage}. */
export interface SmoothedPoint {
  hours: number;
  smoothedV: number;
}

export type LetidVerdict = 'PASS' | 'REVIEW' | 'FAIL' | 'IN_PROGRESS';

export interface OnsetResult {
  /** Exposure hours at the regeneration onset (local minimum), or null. */
  onsetHours: number | null;
  /** Smoothed V_oc at the onset minimum (V), or null. */
  minV: number | null;
}

export interface StopResult {
  stopReached: boolean;
  /** Exposure hours at which the plateau criterion is first satisfied, or null. */
  atHours: number | null;
  reason: string;
}

export interface LetidJudgement {
  verdict: LetidVerdict;
  onsetHours: number | null;
  stopHours: number | null;
  finalV: number | null;
  /** Recovery from the onset minimum to the final value (finalV − minV), V. */
  deltaVFromMin: number | null;
  reason: string;
}

export interface StopOpts {
  /** Trailing window over which the plateau is assessed, hours. Default 12. */
  plateauWindowHrs?: number;
  /** Max permitted V_oc spread within the plateau window, V. Default 0.0005. */
  plateauDeltaV?: number;
}

export interface JudgeOpts extends StopOpts {
  /** Moving-average window, hours. Default 6. */
  windowHrs?: number;
}

const DEFAULT_WINDOW_HRS = 6;
const DEFAULT_PLATEAU_WINDOW_HRS = 12;
const DEFAULT_PLATEAU_DELTA_V = 0.0005;
/** Successive positive-slope samples required to confirm a regeneration onset. */
const ONSET_DEBOUNCE = 3;
/** Clear recovery above the onset minimum that separates PASS from REVIEW, V. */
const RECOVERY_PASS_V = 0.001;
/** Exposure beyond which a no-onset result is a hard FAIL, hours (IEC TS 63342). */
const FAIL_DURATION_HRS = 600;

/**
 * Centred moving average of dark V_oc over a `windowHrs`-wide time window.
 * Centred (not trailing) so the smoothed curve does not lag the raw series —
 * important for locating the regeneration minimum without phase shift. Points
 * are sorted by hours; the result preserves that order.
 */
export function movingAverage(points: LetidPoint[], windowHrs = DEFAULT_WINDOW_HRS): SmoothedPoint[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.hours - b.hours);
  const half = windowHrs / 2;
  return sorted.map((p) => {
    let sum = 0;
    let count = 0;
    for (const q of sorted) {
      if (Math.abs(q.hours - p.hours) <= half) {
        sum += q.darkVoc;
        count += 1;
      }
    }
    return { hours: p.hours, smoothedV: count > 0 ? sum / count : p.darkVoc };
  });
}

/**
 * Regeneration onset: the first local minimum where the smoothed slope goes
 * negative→positive and stays positive for at least {@link ONSET_DEBOUNCE}
 * successive samples (debounces noise blips into a genuine upturn).
 */
export function detectRegenerationOnset(smoothed: SmoothedPoint[]): OnsetResult {
  const n = smoothed.length;
  if (n < ONSET_DEBOUNCE + 2) return { onsetHours: null, minV: null };

  const slope = (k: number) => smoothed[k + 1].smoothedV - smoothed[k].smoothedV;
  for (let k = 1; k <= n - 2; k++) {
    if (slope(k - 1) < 0 && slope(k) > 0) {
      let positiveRun = 0;
      for (let j = k; j <= n - 2 && slope(j) > 0; j++) positiveRun += 1;
      if (positiveRun >= ONSET_DEBOUNCE) {
        return { onsetHours: smoothed[k].hours, minV: smoothed[k].smoothedV };
      }
    }
  }
  return { onsetHours: null, minV: null };
}

/** Max−min spread of smoothedV over the trailing `windowHrs` of the series. */
function trailingWindowSpread(smoothed: SmoothedPoint[], windowHrs: number): number {
  const last = smoothed[smoothed.length - 1];
  let lo = Infinity, hi = -Infinity;
  for (let i = smoothed.length - 1; i >= 0 && smoothed[i].hours >= last.hours - windowHrs; i--) {
    lo = Math.min(lo, smoothed[i].smoothedV);
    hi = Math.max(hi, smoothed[i].smoothedV);
  }
  return hi - lo;
}

/**
 * Plateau stop criterion: TRUE when the trailing `plateauWindowHrs` of smoothed
 * V_oc has a max−min spread ≤ `plateauDeltaV`. Walking backward from the final
 * sample measures only the trailing plateau, so the (zero-slope) regeneration
 * minimum is never mistaken for one. `atHours` is when the criterion is first
 * met — once a full window of flat data has accumulated.
 */
export function evaluateStopCriterion(smoothed: SmoothedPoint[], opts: StopOpts = {}): StopResult {
  const plateauWindowHrs = opts.plateauWindowHrs ?? DEFAULT_PLATEAU_WINDOW_HRS;
  const plateauDeltaV = opts.plateauDeltaV ?? DEFAULT_PLATEAU_DELTA_V;
  const n = smoothed.length;
  if (n === 0) return { stopReached: false, atHours: null, reason: 'No data.' };

  const last = smoothed[n - 1];
  let lo = last.smoothedV;
  let hi = last.smoothedV;
  let startIdx = n - 1;
  for (let i = n - 2; i >= 0; i--) {
    const nextLo = Math.min(lo, smoothed[i].smoothedV);
    const nextHi = Math.max(hi, smoothed[i].smoothedV);
    if (nextHi - nextLo > plateauDeltaV) break;
    lo = nextLo;
    hi = nextHi;
    startIdx = i;
  }

  const plateauStartHours = smoothed[startIdx].hours;
  const plateauSpanHrs = last.hours - plateauStartHours;
  if (plateauSpanHrs >= plateauWindowHrs) {
    return {
      stopReached: true,
      atHours: Math.min(plateauStartHours + plateauWindowHrs, last.hours),
      reason: `Plateau: trailing ΔV=${(hi - lo).toFixed(5)} V ≤ ${plateauDeltaV} V sustained ${plateauSpanHrs.toFixed(0)} h.`,
    };
  }
  return {
    stopReached: false,
    atHours: null,
    reason: `No plateau: ΔV=${trailingWindowSpread(smoothed, plateauWindowHrs).toFixed(5)} V over trailing ${plateauWindowHrs} h > ${plateauDeltaV} V.`,
  };
}

/**
 * Overall LeTID verdict at elevated junction temperature `tjmaxc` (°C):
 *   FAIL        — exposure > 600 h with no regeneration onset (IEC TS 63342).
 *   PASS        — plateau reached AND clear recovery (finalV ≥ minV + 0.001 V).
 *   REVIEW      — plateau reached but recovery marginal (< 0.001 V).
 *   IN_PROGRESS — still degrading / regenerating, no plateau yet.
 */
export function judgeLetid(points: LetidPoint[], tjmaxc: number, opts: JudgeOpts = {}): LetidJudgement {
  const smoothed = movingAverage(points, opts.windowHrs ?? DEFAULT_WINDOW_HRS);
  if (smoothed.length === 0) {
    return { verdict: 'IN_PROGRESS', onsetHours: null, stopHours: null, finalV: null, deltaVFromMin: null, reason: 'No exposure data yet.' };
  }

  const { onsetHours, minV } = detectRegenerationOnset(smoothed);
  const stop = evaluateStopCriterion(smoothed, opts);
  const finalV = smoothed[smoothed.length - 1].smoothedV;
  const durationHrs = smoothed[smoothed.length - 1].hours - smoothed[0].hours;
  const deltaVFromMin = minV != null ? finalV - minV : null;
  const tjNote = ` @ T_j=${tjmaxc} °C`;

  let verdict: LetidVerdict;
  let reason: string;
  if (onsetHours == null) {
    if (durationHrs > FAIL_DURATION_HRS) {
      verdict = 'FAIL';
      reason = `No regeneration onset after ${durationHrs.toFixed(0)} h (> ${FAIL_DURATION_HRS} h limit)${tjNote}.`;
    } else {
      verdict = 'IN_PROGRESS';
      reason = `Degrading — no regeneration onset yet at ${durationHrs.toFixed(0)} h${tjNote}.`;
    }
  } else if (stop.stopReached) {
    const recovery = deltaVFromMin ?? 0;
    if (recovery >= RECOVERY_PASS_V) {
      verdict = 'PASS';
      reason = `Regeneration onset at ${onsetHours.toFixed(0)} h, plateau by ${stop.atHours?.toFixed(0)} h; recovery ΔV=${recovery.toFixed(4)} V ≥ ${RECOVERY_PASS_V} V${tjNote}.`;
    } else {
      verdict = 'REVIEW';
      reason = `Plateau reached at ${stop.atHours?.toFixed(0)} h but recovery ΔV=${recovery.toFixed(4)} V < ${RECOVERY_PASS_V} V — marginal regeneration${tjNote}.`;
    }
  } else {
    verdict = 'IN_PROGRESS';
    reason = `Regeneration onset at ${onsetHours.toFixed(0)} h; awaiting plateau${tjNote}.`;
  }

  return { verdict, onsetHours, stopHours: stop.atHours, finalV, deltaVFromMin, reason };
}
