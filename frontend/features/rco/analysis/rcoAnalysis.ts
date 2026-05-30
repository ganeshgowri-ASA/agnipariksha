/**
 * Reverse Current Overload analysis — IEC 61730-2 MST 26.
 *
 * MST 26 applies a reverse current equal to 1.35× the rated max series
 * fuse current through the module for a configured duration (typically
 * 2 h). The test passes when:
 *   - The applied current envelope stayed within ±5 % of the 1.35× setpoint
 *   - No fire / open-circuit / V-drop > limit was detected
 *   - No backsheet temperature excursion above the 60 °C ceiling (typ.)
 *
 * Pure functions, no React, no I/O. Tested under vitest in
 * rcoAnalysis.test.ts. Mirrors the shape of tcAnalysis.ts / hfAnalysis.ts.
 */
import type { LiveReading } from '@/types/test-session';

export type Verdict = 'pass' | 'warn' | 'fail' | 'pending';
export type RcoPhase = 'idle' | 'ramp-up' | 'soak' | 'ramp-down' | 'complete';

/**
 * MST 26 constants. Pinned alongside the backend orchestrator in
 * backend/test_programs/reverse_current.py — update both files together.
 */
export const RCO_CONSTANTS = {
  /** MST 26 §6 — test current = 1.35× max series fuse rating. */
  ISC_MULTIPLIER: 1.35,
  /** Envelope tolerance around the target reverse current. */
  CURRENT_TOL_PCT: 5.0,
  /** Maximum allowed forward V-drop during the soak (operator-set; default 1 V). */
  DEFAULT_V_DROP_LIMIT: 1.0,
  /** Backsheet/junction temperature ceiling above which the test FAILs (°C). */
  T_MAX_C: 60.0,
  /** Minimum soak required to mark the run complete (default 2 h). */
  MIN_SOAK_S: 2 * 3600,
} as const;

export interface RcoConfig {
  /** Max series fuse rating (A) the operator entered. */
  fuseRating: number;
  /** Forward V-drop limit (V) — applied to MEAS:VOLT? while sourcing reverse. */
  voltageLimit: number;
  /** Operator-configured soak duration (h). */
  durationHours: number;
}

export interface RcoKpis {
  phase: RcoPhase;
  /** 1.35 × fuseRating — the live target setpoint. */
  testCurrentA: number;
  /** Last observed reverse current magnitude (A). null when no readings. */
  measuredCurrentA: number | null;
  /** Worst absolute deviation from the test current (A). */
  worstCurrentDevA: number;
  currentEnvelopeVerdict: Verdict;
  /** Last observed forward V-drop (V). */
  voltageDropV: number | null;
  voltageDropVerdict: Verdict;
  /** Worst backsheet temperature seen (°C). */
  worstTempC: number;
  temperatureVerdict: Verdict;
  /** Cumulative seconds in the soak band (current within tolerance). */
  soakDurationS: number;
  soakDurationVerdict: Verdict;
  /** Composite verdict — pending until soak >= target. */
  overallVerdict: Verdict;
}

function classifyCurrentDev(devPct: number): Verdict {
  if (devPct <= RCO_CONSTANTS.CURRENT_TOL_PCT) return 'pass';
  if (devPct <= RCO_CONSTANTS.CURRENT_TOL_PCT * 2) return 'warn';
  return 'fail';
}

function classifyVoltageDrop(v: number, limit: number): Verdict {
  if (v <= limit) return 'pass';
  if (v <= limit * 1.2) return 'warn';
  return 'fail';
}

function classifyTemperature(t: number): Verdict {
  if (t < RCO_CONSTANTS.T_MAX_C * 0.9) return 'pass';
  if (t < RCO_CONSTANTS.T_MAX_C) return 'warn';
  return 'fail';
}

function classifySoak(actualS: number, targetS: number): Verdict {
  if (actualS >= targetS) return 'pass';
  if (actualS >= targetS * 0.95) return 'warn';
  if (actualS === 0) return 'pending';
  return 'fail';
}

/** Detect the current phase of the run based on the trajectory. */
function detectPhase(readings: LiveReading[], target: number): RcoPhase {
  if (readings.length === 0) return 'idle';
  const cur = readings[readings.length - 1];
  if (cur.current === undefined) return 'idle';
  const absCur = Math.abs(cur.current);
  const inBand = Math.abs(absCur - target) / target <= RCO_CONSTANTS.CURRENT_TOL_PCT / 100;
  if (inBand) return 'soak';
  if (readings.length < 2) return 'ramp-up';
  const prev = readings[readings.length - 2];
  if (prev.current === undefined) return 'ramp-up';
  const trend = Math.abs(cur.current) - Math.abs(prev.current);
  if (Math.abs(absCur) < target * 0.1) return 'complete';
  return trend > 0 ? 'ramp-up' : 'ramp-down';
}

export function computeRcoKpis(readings: LiveReading[], cfg: RcoConfig): RcoKpis {
  const testCurrent = cfg.fuseRating * RCO_CONSTANTS.ISC_MULTIPLIER;
  const targetSoakS = cfg.durationHours * 3600;

  if (readings.length === 0) {
    return {
      phase: 'idle',
      testCurrentA: testCurrent,
      measuredCurrentA: null,
      worstCurrentDevA: 0,
      currentEnvelopeVerdict: 'pending',
      voltageDropV: null,
      voltageDropVerdict: 'pending',
      worstTempC: 0,
      temperatureVerdict: 'pending',
      soakDurationS: 0,
      soakDurationVerdict: 'pending',
      overallVerdict: 'pending',
    };
  }

  const cur = readings[readings.length - 1];
  const phase = detectPhase(readings, testCurrent);

  // Accumulate envelope deviation + soak duration + worst temp.
  let worstCurrentDevA = 0;
  let soakDurationS = 0;
  let worstTempC = -Infinity;
  for (let i = 0; i < readings.length; i++) {
    const r = readings[i];
    if (r.current !== undefined) {
      const dev = Math.abs(Math.abs(r.current) - testCurrent);
      if (dev > worstCurrentDevA) worstCurrentDevA = dev;
    }
    if (r.temperature !== undefined && r.temperature > worstTempC) {
      worstTempC = r.temperature;
    }
    if (i > 0 && r.current !== undefined) {
      const prev = readings[i - 1];
      const dtS = (r.timestamp - prev.timestamp) / 1000;
      const inBand = Math.abs(Math.abs(r.current) - testCurrent) / testCurrent <= RCO_CONSTANTS.CURRENT_TOL_PCT / 100;
      if (inBand) soakDurationS += dtS;
    }
  }
  if (worstTempC === -Infinity) worstTempC = 0;

  const measuredCurrentA = cur.current !== undefined ? Math.abs(cur.current) : null;
  const worstDevPct = (worstCurrentDevA / testCurrent) * 100;
  const currentEnvelopeVerdict = classifyCurrentDev(worstDevPct);

  // Voltage drop while sourcing reverse current is the forward V-drop across
  // the module — we use the absolute value to be tolerant of sign conventions.
  const voltageDropV = cur.voltage !== undefined ? Math.abs(cur.voltage) : null;
  const voltageDropVerdict = voltageDropV === null
    ? 'pending'
    : classifyVoltageDrop(voltageDropV, cfg.voltageLimit);

  const temperatureVerdict = readings.some((r) => r.temperature !== undefined)
    ? classifyTemperature(worstTempC)
    : 'pending';

  const soakDurationVerdict = classifySoak(soakDurationS, targetSoakS);

  // Composite: pending until soak target met; then worst-of all 4.
  let overallVerdict: Verdict = 'pending';
  if (soakDurationVerdict !== 'pending') {
    const all = [currentEnvelopeVerdict, voltageDropVerdict, temperatureVerdict, soakDurationVerdict];
    if (all.some((v) => v === 'fail')) overallVerdict = 'fail';
    else if (all.some((v) => v === 'warn')) overallVerdict = 'warn';
    else if (all.every((v) => v === 'pass')) overallVerdict = 'pass';
    else overallVerdict = 'pending';
  }

  return {
    phase,
    testCurrentA: testCurrent,
    measuredCurrentA,
    worstCurrentDevA,
    currentEnvelopeVerdict,
    voltageDropV,
    voltageDropVerdict,
    worstTempC,
    temperatureVerdict,
    soakDurationS,
    soakDurationVerdict,
    overallVerdict,
  };
}
