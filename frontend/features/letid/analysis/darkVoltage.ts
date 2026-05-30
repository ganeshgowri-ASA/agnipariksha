/**
 * IEC TS 63342 — LeTID dark-voltage time-series, stabilization (stop) criterion
 * and measurement-uncertainty helpers.
 *
 * The LeTID soak alternates between an *injection* phase (the PSU drives the
 * dark current Idark = Isc − Imp into the module) and a *dark* phase (no
 * injection, current ≈ 0). The module **dark voltage** is the terminal voltage
 * sampled during that dark/no-injection phase — it is the signal whose
 * degradation-then-regeneration TS 63342 tracks. These pure helpers:
 *
 *   • {@link darkVoltageSeries} — extract the dark-phase samples from the raw
 *     live-reading stream (rejecting injection-phase samples) onto a shared
 *     elapsed-hours time axis, carrying module temperature and current so the
 *     monitor can plot dark voltage, temperature and injected current together.
 *   • {@link stopCriterion} — the TS 63342 stabilization rule: STOP when the
 *     relative change of dark voltage over a trailing window stays within a
 *     threshold (steady state reached), subject to a minimum soak duration.
 *   • {@link measurementUncertainty} — combined + expanded (k = 2) standard
 *     uncertainty of a dark-voltage / Pmax measurement from IEC-referenced
 *     calibration and resolution components.
 *
 * No React / DOM — framework-free so it is unit-testable under vitest in
 * darkVoltage.test.ts. The backend mirrors the stop-criterion and uncertainty
 * math in backend/test_programs/letid.py so client and server agree.
 */
import type { LiveReading } from '@/types/test-session';

/** One dark-phase sample on the shared elapsed-hours axis. */
export interface DarkVoltagePoint {
  /** Elapsed soak time since the first reading, hours. */
  hours: number;
  /** Module terminal voltage during the dark/no-injection phase, V. */
  darkVoltage: number;
  /** Module temperature at the sample, °C (undefined if not telemetered). */
  temperature?: number;
  /** Injected current at the sample, A (≈ 0 by construction for dark samples). */
  current: number;
}

export interface DarkVoltageConfig {
  /**
   * Current magnitude at/below which a sample counts as a *dark* (no-injection)
   * sample, A. Defaults to {@link LETID_DARKV_CONSTANTS.DARK_CURRENT_EPS_A}.
   */
  darkCurrentEpsA?: number;
}

/** Stop-criterion outcome. */
export interface StopCriterionResult {
  /** TRUE when the stabilization criterion is satisfied. */
  met: boolean;
  /** Operator-readable explanation citing the TS 63342 stabilization rule. */
  reason: string;
  /**
   * Relative dark-voltage drift over the trailing window, fraction (e.g. 0.004
   * = 0.4 %), or null when the window has not yet accumulated enough data.
   */
  relativeDrift: number | null;
  /** Elapsed hours spanned by the evaluated trailing window. */
  windowSpanHrs: number;
}

export interface StopCriterionConfig {
  /** Trailing window over which steady state is assessed, hours. Default 24. */
  windowHrs?: number;
  /**
   * Max permitted relative dark-voltage change within the window for "stable",
   * fraction. Default 0.005 (0.5 %), the TS 63342 stabilization convention.
   */
  relThreshold?: number;
  /** Minimum soak before a stop may be declared, hours. Default 162. */
  minSoakHrs?: number;
}

/** Measurement-uncertainty budget for a single dark-voltage / Pmax reading. */
export interface UncertaintyResult {
  /** Combined standard uncertainty u_c (1σ) in the measurement's own unit. */
  standard: number;
  /** Expanded uncertainty U = k·u_c. */
  expanded: number;
  /** Coverage factor k used for the expansion (2 → ~95 %). */
  k: number;
  /** Expanded uncertainty as a fraction of the measured value (NaN if value 0). */
  relative: number;
}

export interface UncertaintyConfig {
  /**
   * Relative calibration uncertainty of the measuring instrument (fraction of
   * reading, 1σ). Default {@link LETID_DARKV_CONSTANTS.CAL_REL_STD}.
   */
  calRelStd?: number;
  /**
   * Display/quantisation resolution of the instrument in the measured unit
   * (full last-digit step). Contributes a rectangular component u = res/√12.
   * Default {@link LETID_DARKV_CONSTANTS.VOLT_RESOLUTION_V}.
   */
  resolution?: number;
  /** Coverage factor for the expansion. Default 2 (≈ 95 %). */
  k?: number;
}

/**
 * IEC-referenced constants. Kept here (and mirrored in the backend) so the
 * dark-voltage detection, stabilization rule and uncertainty budget cannot
 * drift between client display and server control.
 */
export const LETID_DARKV_CONSTANTS = {
  /** A sample counts as "dark" when |I| ≤ this (A). */
  DARK_CURRENT_EPS_A: 0.05,
  /** TS 63342 stabilization window, hours. */
  STABILIZATION_WINDOW_HRS: 24,
  /** TS 63342 stabilization relative threshold (fraction). */
  STABILIZATION_REL_THRESHOLD: 0.005,
  /** TS 63342 minimum LeTID soak duration, hours. */
  MIN_SOAK_HRS: 162,
  /**
   * Default relative calibration uncertainty of the V/Pmax measurement (1σ).
   * Representative of a calibrated source-measure unit; tune per cal cert.
   */
  CAL_REL_STD: 0.002,
  /** Default voltmeter last-digit resolution (V). */
  VOLT_RESOLUTION_V: 0.001,
  /** Coverage factor for expanded uncertainty (≈ 95 %). */
  COVERAGE_K: 2,
} as const;

/**
 * Extract the dark-phase voltage samples from a raw live-reading stream.
 *
 * A reading is a *dark* sample when its current magnitude is within
 * `darkCurrentEpsA` of zero (the no-injection phase). Injection-phase samples
 * (|I| above the epsilon) are dropped — their terminal voltage is the driven
 * Vmpp, not the open dark voltage. Hours are measured from the first reading in
 * the stream (not the first dark sample) so the dark-voltage trace shares its
 * time origin with the temperature and injected-current traces. Output is
 * sorted ascending by time.
 */
export function darkVoltageSeries(
  readings: LiveReading[],
  cfg: DarkVoltageConfig = {},
): DarkVoltagePoint[] {
  if (readings.length === 0) return [];
  const eps = cfg.darkCurrentEpsA ?? LETID_DARKV_CONSTANTS.DARK_CURRENT_EPS_A;
  const sorted = [...readings].sort((a, b) => a.timestamp - b.timestamp);
  const t0 = sorted[0].timestamp;
  const out: DarkVoltagePoint[] = [];
  for (const r of sorted) {
    if (Math.abs(r.current) > eps) continue; // injection sample — not dark
    out.push({
      hours: (r.timestamp - t0) / 3_600_000,
      darkVoltage: r.voltage,
      temperature: r.temperature,
      current: r.current,
    });
  }
  return out;
}

/**
 * TS 63342 stabilization (stop) criterion.
 *
 * The LeTID soak may be stopped once the dark voltage has *stabilized*: the
 * relative change across the trailing `windowHrs` of dark samples stays within
 * `relThreshold`, AND the module has been soaked for at least `minSoakHrs`
 * (TS 63342 minimum exposure). Relative change is (max − min)/mean over the
 * trailing window — a robust, monotonicity-agnostic measure of residual drift,
 * so both an ongoing degradation slope and a regeneration slope keep the test
 * running until the curve flattens.
 *
 * Returns `met=false` (with a descriptive reason) when there is insufficient
 * data, the trailing window is too short, the drift exceeds the threshold, or
 * the minimum soak has not elapsed.
 */
export function stopCriterion(
  series: DarkVoltagePoint[],
  cfg: StopCriterionConfig = {},
): StopCriterionResult {
  const windowHrs = cfg.windowHrs ?? LETID_DARKV_CONSTANTS.STABILIZATION_WINDOW_HRS;
  const relThreshold = cfg.relThreshold ?? LETID_DARKV_CONSTANTS.STABILIZATION_REL_THRESHOLD;
  const minSoakHrs = cfg.minSoakHrs ?? LETID_DARKV_CONSTANTS.MIN_SOAK_HRS;

  const n = series.length;
  if (n === 0) {
    return { met: false, reason: 'No dark-voltage samples yet.', relativeDrift: null, windowSpanHrs: 0 };
  }

  const sorted = [...series].sort((a, b) => a.hours - b.hours);
  const last = sorted[n - 1];
  const soakHrs = last.hours - sorted[0].hours;

  // Collect the trailing window [last.hours − windowHrs, last.hours].
  let lo = Infinity;
  let hi = -Infinity;
  let sum = 0;
  let count = 0;
  let windowStartHrs = last.hours;
  for (let i = n - 1; i >= 0 && sorted[i].hours >= last.hours - windowHrs; i--) {
    const v = sorted[i].darkVoltage;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
    sum += v;
    count += 1;
    windowStartHrs = sorted[i].hours;
  }
  const windowSpanHrs = last.hours - windowStartHrs;

  // Need a genuinely populated trailing window before judging stability.
  if (count < 2 || windowSpanHrs < windowHrs - 1e-9) {
    return {
      met: false,
      reason: `Stabilization window not yet full (${windowSpanHrs.toFixed(1)} h of ${windowHrs} h).`,
      relativeDrift: null,
      windowSpanHrs,
    };
  }

  const mean = sum / count;
  const relativeDrift = mean !== 0 ? (hi - lo) / Math.abs(mean) : Infinity;
  const driftPct = (relativeDrift * 100).toFixed(3);
  const thrPct = (relThreshold * 100).toFixed(2);

  if (relativeDrift > relThreshold) {
    return {
      met: false,
      reason: `Not stabilized: trailing ΔV/V=${driftPct}% over ${windowHrs} h > ${thrPct}% (TS 63342 stabilization).`,
      relativeDrift,
      windowSpanHrs,
    };
  }
  if (soakHrs < minSoakHrs) {
    return {
      met: false,
      reason: `Dark voltage stable (ΔV/V=${driftPct}% ≤ ${thrPct}%) but soak ${soakHrs.toFixed(0)} h < ${minSoakHrs} h minimum (TS 63342).`,
      relativeDrift,
      windowSpanHrs,
    };
  }
  return {
    met: true,
    reason: `Stabilized: trailing ΔV/V=${driftPct}% ≤ ${thrPct}% over ${windowHrs} h after ${soakHrs.toFixed(0)} h soak (TS 63342).`,
    relativeDrift,
    windowSpanHrs,
  };
}

/**
 * Combined + expanded measurement uncertainty for a dark-voltage (or Pmax)
 * reading of magnitude `value`, per the GUM root-sum-square model that IEC
 * test reports use.
 *
 * Two components are combined in quadrature:
 *   • calibration — relative to the reading: u_cal = calRelStd · |value| (1σ);
 *   • resolution  — rectangular distribution of half-width res/2:
 *                   u_res = res / √12.
 *
 * The expanded uncertainty is U = k · u_c (default k = 2 → ≈ 95 % coverage).
 * Returns the standard (1σ) and expanded uncertainties in the measurement's
 * unit plus the expanded value as a fraction of the reading.
 */
export function measurementUncertainty(
  value: number,
  cfg: UncertaintyConfig = {},
): UncertaintyResult {
  const calRelStd = cfg.calRelStd ?? LETID_DARKV_CONSTANTS.CAL_REL_STD;
  const resolution = cfg.resolution ?? LETID_DARKV_CONSTANTS.VOLT_RESOLUTION_V;
  const k = cfg.k ?? LETID_DARKV_CONSTANTS.COVERAGE_K;

  const uCal = calRelStd * Math.abs(value);
  const uRes = resolution / Math.sqrt(12);
  const standard = Math.sqrt(uCal * uCal + uRes * uRes);
  const expanded = k * standard;
  const relative = value !== 0 ? expanded / Math.abs(value) : NaN;
  return { standard, expanded, k, relative };
}
