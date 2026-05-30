/**
 * PID analysis — IEC TS 62804-1 (Method A: dry surface, 1000 V bias).
 *
 * The standard tests with a system-voltage bias for 96 h at 60 °C / 85 %RH
 * (Method A). Pass criteria (Gate 2 default):
 *   - Pre-test Pmax baseline captured
 *   - Post-test Pmax decay ≤ 5 % (some labs use 3 %)
 *   - Leakage current I_leak monotonic / bounded during the soak
 *   - Environmental envelope (T and RH) held within tolerance
 *
 * This module ships the pure math; the React panel
 * (PidAnalysisPanel.tsx) consumes the KPI snapshot.
 */
import type { LiveReading } from '@/types/test-session';

export type Verdict = 'pass' | 'warn' | 'fail' | 'pending';
export type PidPhase = 'idle' | 'ramping-bias' | 'soak' | 'recovery' | 'complete';

export const PID_CONSTANTS = {
  /** TS 62804-1 §7 — Gate 2 ΔPmax pass threshold (default). */
  DELTA_PMAX_PASS_PCT: 5.0,
  /** Warn band — between 5 and 8 % is flagged amber for operator review. */
  DELTA_PMAX_WARN_PCT: 8.0,
  /** Environment tolerances for Method A. */
  T_TARGET_C: 60.0,
  T_TOL_C: 2.0,
  RH_TARGET_PCT: 85.0,
  RH_TOL_PCT: 5.0,
  /** Leakage-current ceiling above which the test FAILs (typ. 5 μA per IEC TS 62804-1-1). */
  I_LEAK_MAX_A: 5e-6,
  /** Minimum soak duration for Method A. */
  MIN_SOAK_S: 96 * 3600,
} as const;

export interface PidConfig {
  /** Operator-configured bias (typically ±1000 V). */
  biasVoltage: number;
  /** Chamber temperature setpoint °C (typ. 60). */
  tempC: number;
  /** Chamber humidity setpoint %RH (typ. 85). */
  rhPct: number;
  /** Soak duration hours (typ. 96). */
  durationHours: number;
  /** Baseline Pmax (W) measured before the soak — operator-entered. */
  baselinePmax?: number;
}

export interface PidKpis {
  phase: PidPhase;
  /** Latest measured bias voltage. */
  biasV: number | null;
  /** Latest leakage current magnitude (A). */
  iLeakA: number | null;
  /** Peak leakage current during the run. */
  peakILeakA: number;
  iLeakVerdict: Verdict;
  /** Latest module temperature reading. */
  tModuleC: number | null;
  /** Worst temperature deviation from target |T - 60|. */
  worstTDevC: number;
  tempVerdict: Verdict;
  /** Latest RH reading. */
  rhPct: number | null;
  worstRhDevPct: number;
  rhVerdict: Verdict;
  /** Cumulative soak seconds (bias active and environment in band). */
  soakDurationS: number;
  soakDurationVerdict: Verdict;
  /** Estimated current ΔPmax — null until operator enters post-test Pmax. */
  deltaPmaxPct: number | null;
  deltaPmaxVerdict: Verdict;
  /** Composite — pending until soak target met. */
  overallVerdict: Verdict;
}

function readHumidity(r: LiveReading): number | null {
  const rh = (r as LiveReading & { humidity?: number }).humidity;
  return typeof rh === 'number' ? rh : null;
}

function classifyILeak(peak: number): Verdict {
  if (peak < PID_CONSTANTS.I_LEAK_MAX_A * 0.5) return 'pass';
  if (peak < PID_CONSTANTS.I_LEAK_MAX_A) return 'warn';
  return 'fail';
}

function classifyTempDev(worstDev: number): Verdict {
  if (worstDev <= PID_CONSTANTS.T_TOL_C) return 'pass';
  if (worstDev <= PID_CONSTANTS.T_TOL_C * 2) return 'warn';
  return 'fail';
}

function classifyRhDev(worstDev: number): Verdict {
  if (worstDev <= PID_CONSTANTS.RH_TOL_PCT) return 'pass';
  if (worstDev <= PID_CONSTANTS.RH_TOL_PCT * 2) return 'warn';
  return 'fail';
}

function classifyDeltaPmax(deltaPct: number): Verdict {
  if (deltaPct <= PID_CONSTANTS.DELTA_PMAX_PASS_PCT) return 'pass';
  if (deltaPct <= PID_CONSTANTS.DELTA_PMAX_WARN_PCT) return 'warn';
  return 'fail';
}

function classifySoak(actualS: number, targetS: number): Verdict {
  if (actualS >= targetS) return 'pass';
  if (actualS >= targetS * 0.95) return 'warn';
  if (actualS === 0) return 'pending';
  return 'fail';
}

function detectPhase(readings: LiveReading[], cfg: PidConfig): PidPhase {
  if (readings.length === 0) return 'idle';
  const cur = readings[readings.length - 1];
  if (cur.voltage === undefined) return 'idle';
  const inBiasBand =
    Math.abs(Math.abs(cur.voltage) - Math.abs(cfg.biasVoltage)) <= Math.abs(cfg.biasVoltage) * 0.02;
  const inTempBand = cur.temperature !== undefined &&
    Math.abs(cur.temperature - cfg.tempC) <= PID_CONSTANTS.T_TOL_C;
  if (Math.abs(cur.voltage) < Math.abs(cfg.biasVoltage) * 0.05) return 'recovery';
  if (inBiasBand && inTempBand) return 'soak';
  return 'ramping-bias';
}

export function computePidKpis(readings: LiveReading[], cfg: PidConfig): PidKpis {
  const targetSoakS = cfg.durationHours * 3600;

  if (readings.length === 0) {
    return {
      phase: 'idle',
      biasV: null, iLeakA: null, peakILeakA: 0,
      iLeakVerdict: 'pending',
      tModuleC: null, worstTDevC: 0, tempVerdict: 'pending',
      rhPct: null, worstRhDevPct: 0, rhVerdict: 'pending',
      soakDurationS: 0, soakDurationVerdict: 'pending',
      deltaPmaxPct: null, deltaPmaxVerdict: 'pending',
      overallVerdict: 'pending',
    };
  }

  const cur = readings[readings.length - 1];
  const phase = detectPhase(readings, cfg);
  const curRh = readHumidity(cur);

  let peakILeakA = 0;
  let soakDurationS = 0;
  let worstTDevC = 0;
  let worstRhDevPct = 0;
  let rhSamples = 0;
  for (let i = 0; i < readings.length; i++) {
    const r = readings[i];
    if (r.current !== undefined) {
      const absI = Math.abs(r.current);
      if (absI > peakILeakA) peakILeakA = absI;
    }
    if (r.temperature !== undefined) {
      const dev = Math.abs(r.temperature - cfg.tempC);
      if (dev > worstTDevC) worstTDevC = dev;
    }
    const rh = readHumidity(r);
    if (rh !== null) {
      rhSamples += 1;
      const dev = Math.abs(rh - cfg.rhPct);
      if (dev > worstRhDevPct) worstRhDevPct = dev;
    }
    if (i > 0 && r.voltage !== undefined) {
      const prev = readings[i - 1];
      const dtS = (r.timestamp - prev.timestamp) / 1000;
      const biasOk = Math.abs(Math.abs(r.voltage) - Math.abs(cfg.biasVoltage))
        <= Math.abs(cfg.biasVoltage) * 0.02;
      const tempOk = r.temperature !== undefined
        && Math.abs(r.temperature - cfg.tempC) <= PID_CONSTANTS.T_TOL_C;
      if (biasOk && tempOk) soakDurationS += dtS;
    }
  }

  const iLeakVerdict = readings.some((r) => r.current !== undefined)
    ? classifyILeak(peakILeakA)
    : 'pending';
  const tempVerdict = readings.some((r) => r.temperature !== undefined)
    ? classifyTempDev(worstTDevC)
    : 'pending';
  const rhVerdict = rhSamples > 0
    ? classifyRhDev(worstRhDevPct)
    : 'pending';
  const soakDurationVerdict = classifySoak(soakDurationS, targetSoakS);

  // ΔPmax — only meaningful once the operator has captured the baseline AND
  // recorded a post-test Pmax. We expose the verdict shell now; the panel
  // gets a "no baseline yet" empty state via the null deltaPmaxPct.
  let deltaPmaxPct: number | null = null;
  let deltaPmaxVerdict: Verdict = 'pending';
  if (cfg.baselinePmax && cfg.baselinePmax > 0) {
    // After soak we use the average of the last 10 power readings as the
    // post-soak Pmax estimate. This is a heuristic; precise Pmax requires
    // a separate IV-curve sweep that the operator performs offline.
    const tail = readings.slice(-10).filter((r) => r.power !== undefined);
    if (tail.length > 0) {
      const postEstimate = tail.reduce((a, r) => a + (r.power ?? 0), 0) / tail.length;
      deltaPmaxPct = Math.max(0, ((cfg.baselinePmax - Math.abs(postEstimate)) / cfg.baselinePmax) * 100);
      deltaPmaxVerdict = classifyDeltaPmax(deltaPmaxPct);
    }
  }

  let overallVerdict: Verdict = 'pending';
  if (soakDurationVerdict !== 'pending') {
    const all = [iLeakVerdict, tempVerdict, rhVerdict, soakDurationVerdict];
    if (deltaPmaxVerdict !== 'pending') all.push(deltaPmaxVerdict);
    if (all.some((v) => v === 'fail')) overallVerdict = 'fail';
    else if (all.some((v) => v === 'warn')) overallVerdict = 'warn';
    else if (all.every((v) => v === 'pass')) overallVerdict = 'pass';
  }

  return {
    phase,
    biasV: cur.voltage ?? null,
    iLeakA: cur.current === undefined ? null : Math.abs(cur.current),
    peakILeakA,
    iLeakVerdict,
    tModuleC: cur.temperature ?? null,
    worstTDevC,
    tempVerdict,
    rhPct: curRh,
    worstRhDevPct,
    rhVerdict,
    soakDurationS,
    soakDurationVerdict,
    deltaPmaxPct,
    deltaPmaxVerdict,
    overallVerdict,
  };
}
