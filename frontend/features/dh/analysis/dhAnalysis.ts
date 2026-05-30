/**
 * Damp Heat analysis — IEC 61215-2 MQT 13.
 *
 * MQT 13 is a single sustained 85 °C / 85 %RH soak for 1000 h (Gate-2)
 * with optional system bias. Pass criteria:
 *   - Environment held in spec throughout (T 85 ±2, RH 85 ±5)
 *   - Total soak duration ≥ target (typ. 1000 h)
 *   - Pmax decay vs pre-test baseline ≤ 5 % (Gate 2) — operator-entered
 *
 * Similar shape to HF but no freeze cycle and a much longer soak.
 * Same panel/verdict pattern as the other IEC tabs.
 */
import type { LiveReading } from '@/types/test-session';

export type Verdict = 'pass' | 'warn' | 'fail' | 'pending';
export type DhPhase = 'idle' | 'ramping-up' | 'soak' | 'ramping-down' | 'complete';

export const DH_CONSTANTS = {
  /** MQT 13 Gate-2 ΔPmax threshold. */
  DELTA_PMAX_PASS_PCT: 5.0,
  DELTA_PMAX_WARN_PCT: 8.0,
  T_TARGET_C: 85.0,
  T_TOL_C: 2.0,
  RH_TARGET_PCT: 85.0,
  RH_TOL_PCT: 5.0,
  /** Minimum soak duration (h) for Gate 2 qualification. */
  MIN_SOAK_S: 1000 * 3600,
} as const;

export interface DhConfig {
  tempC: number;
  rhPct: number;
  durationHours: number;
  biasVoltage: number;
  baselinePmax?: number;
}

export interface DhKpis {
  phase: DhPhase;
  tModuleC: number | null;
  rhPct: number | null;
  worstTDevC: number;
  worstRhDevPct: number;
  tempVerdict: Verdict;
  rhVerdict: Verdict;
  soakDurationS: number;
  soakDurationVerdict: Verdict;
  deltaPmaxPct: number | null;
  deltaPmaxVerdict: Verdict;
  overallVerdict: Verdict;
}

function readRh(r: LiveReading): number | null {
  const rh = (r as LiveReading & { humidity?: number }).humidity;
  return typeof rh === 'number' ? rh : null;
}

function classifyTempDev(d: number): Verdict {
  if (d <= DH_CONSTANTS.T_TOL_C) return 'pass';
  if (d <= DH_CONSTANTS.T_TOL_C * 2) return 'warn';
  return 'fail';
}

function classifyRhDev(d: number): Verdict {
  if (d <= DH_CONSTANTS.RH_TOL_PCT) return 'pass';
  if (d <= DH_CONSTANTS.RH_TOL_PCT * 2) return 'warn';
  return 'fail';
}

function classifySoak(actualS: number, targetS: number): Verdict {
  if (actualS >= targetS) return 'pass';
  if (actualS >= targetS * 0.95) return 'warn';
  if (actualS === 0) return 'pending';
  return 'fail';
}

function classifyDeltaPmax(p: number): Verdict {
  if (p <= DH_CONSTANTS.DELTA_PMAX_PASS_PCT) return 'pass';
  if (p <= DH_CONSTANTS.DELTA_PMAX_WARN_PCT) return 'warn';
  return 'fail';
}

function detectPhase(readings: LiveReading[], cfg: DhConfig): DhPhase {
  if (readings.length === 0) return 'idle';
  const cur = readings[readings.length - 1];
  if (cur.temperature === undefined) return 'idle';
  const inBand = Math.abs(cur.temperature - cfg.tempC) <= DH_CONSTANTS.T_TOL_C;
  if (inBand) return 'soak';
  if (cur.temperature > cfg.tempC) return 'ramping-down';
  return 'ramping-up';
}

export function computeDhKpis(readings: LiveReading[], cfg: DhConfig): DhKpis {
  const targetSoakS = cfg.durationHours * 3600;
  if (readings.length === 0) {
    return {
      phase: 'idle',
      tModuleC: null, rhPct: null,
      worstTDevC: 0, worstRhDevPct: 0,
      tempVerdict: 'pending', rhVerdict: 'pending',
      soakDurationS: 0, soakDurationVerdict: 'pending',
      deltaPmaxPct: null, deltaPmaxVerdict: 'pending',
      overallVerdict: 'pending',
    };
  }
  const cur = readings[readings.length - 1];
  const phase = detectPhase(readings, cfg);

  let worstTDevC = 0;
  let worstRhDevPct = 0;
  let rhSamples = 0;
  let soakDurationS = 0;
  for (let i = 0; i < readings.length; i++) {
    const r = readings[i];
    if (r.temperature !== undefined) {
      const d = Math.abs(r.temperature - cfg.tempC);
      if (d > worstTDevC) worstTDevC = d;
    }
    const rh = readRh(r);
    if (rh !== null) {
      rhSamples += 1;
      const d = Math.abs(rh - cfg.rhPct);
      if (d > worstRhDevPct) worstRhDevPct = d;
    }
    if (i > 0 && r.temperature !== undefined) {
      const dt = (r.timestamp - readings[i - 1].timestamp) / 1000;
      const inBand = Math.abs(r.temperature - cfg.tempC) <= DH_CONSTANTS.T_TOL_C;
      if (inBand) soakDurationS += dt;
    }
  }

  const tempVerdict = readings.some((r) => r.temperature !== undefined)
    ? classifyTempDev(worstTDevC) : 'pending';
  const rhVerdict = rhSamples > 0 ? classifyRhDev(worstRhDevPct) : 'pending';
  const soakDurationVerdict = classifySoak(soakDurationS, targetSoakS);

  let deltaPmaxPct: number | null = null;
  let deltaPmaxVerdict: Verdict = 'pending';
  if (cfg.baselinePmax && cfg.baselinePmax > 0) {
    const tail = readings.slice(-10).filter((r) => r.power !== undefined);
    if (tail.length > 0) {
      const post = tail.reduce((a, r) => a + (r.power ?? 0), 0) / tail.length;
      deltaPmaxPct = Math.max(0, ((cfg.baselinePmax - Math.abs(post)) / cfg.baselinePmax) * 100);
      deltaPmaxVerdict = classifyDeltaPmax(deltaPmaxPct);
    }
  }

  let overallVerdict: Verdict = 'pending';
  if (soakDurationVerdict !== 'pending') {
    const all = [tempVerdict, rhVerdict, soakDurationVerdict];
    if (deltaPmaxVerdict !== 'pending') all.push(deltaPmaxVerdict);
    if (all.some((v) => v === 'fail')) overallVerdict = 'fail';
    else if (all.some((v) => v === 'warn')) overallVerdict = 'warn';
    else if (all.every((v) => v === 'pass')) overallVerdict = 'pass';
  }

  return {
    phase,
    tModuleC: cur.temperature ?? null,
    rhPct: readRh(cur),
    worstTDevC, worstRhDevPct,
    tempVerdict, rhVerdict,
    soakDurationS, soakDurationVerdict,
    deltaPmaxPct, deltaPmaxVerdict,
    overallVerdict,
  };
}
