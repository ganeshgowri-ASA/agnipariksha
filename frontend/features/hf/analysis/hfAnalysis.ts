/**
 * Humidity Freeze analysis — IEC 61215-2 MQT 12.
 *
 * Tracks the four operator-visible KPIs of the test:
 *   - cycle index (one MQT 12 cycle = hot/humid soak + freeze)
 *   - current phase (HOT_HUMID_SOAK / TRANSITION / COLD_FREEZE / IDLE)
 *   - hot dwell duration ≥ 20 h compliance (MQT 12.6.2 a)
 *   - cold dwell duration ≥ 30 min compliance (MQT 12.6.2 b)
 *   - RH compliance: hot soak must hold 85 % ± 5 (MQT 12.6.2 a)
 *   - Isc-gate state (current applied only when T_module > 25 °C —
 *     same MQT 11.6.3 a rule cross-referenced here)
 *
 * Pure functions, no React, no I/O. Same shape as
 * frontend/features/tc/analysis/tcAnalysis.ts so the IEC test family
 * stays internally consistent.
 */
import type { LiveReading } from '@/types/test-session';

export type DwellVerdict = 'pass' | 'warn' | 'fail' | 'pending';
export type RhVerdict = 'pass' | 'warn' | 'fail' | 'pending';
export type IscGateState = 'injecting' | 'cooling' | 'unknown';
export type HfPhase = 'idle' | 'hot-humid-soak' | 'transition-down' | 'cold-freeze' | 'transition-up';

/**
 * MQT 12 constants. Mirror MQT11_* in
 * backend/test_programs/humidity_freeze.py / thermal_cycling.py — when
 * IEC 61215-2 revisions land, update both sides together.
 */
export const HF_CONSTANTS = {
  /** MQT 12.6.2 a — hot/humid dwell ≥ 20 h. */
  HOT_DWELL_MIN_S: 20 * 3600,
  /** MQT 12.6.2 b — cold freeze dwell ≥ 30 min. */
  COLD_DWELL_MIN_S: 30 * 60,
  /** MQT 12.6.2 — total transition < 30 min. */
  TRANSITION_MAX_S: 30 * 60,
  /** Hot soak RH target 85% ± 5 %. */
  RH_TARGET_PCT: 85,
  RH_TOL_PCT: 5,
  /** Hot soak T target 85 °C ± 2. */
  T_HOT_TARGET_C: 85,
  T_HOT_TOL_C: 2,
  /** Cold freeze T target −40 °C ± 2. */
  T_COLD_TARGET_C: -40,
  T_COLD_TOL_C: 2,
  /** MQT 11.6.3 a — Isc only when T > 25 °C. */
  ISC_GATE_C: 25,
  /** Default qualification cycle count. */
  DEFAULT_CYCLES: 10,
} as const;

export interface HfConfig {
  cycles: number;
  tHigh: number;
  rhHigh: number;
  tLow: number;
  /** Operator-configured hot dwell in hours (clamped to ≥20 in the orchestrator). */
  dwellHours: number;
  /** Configured Isc (A) for the hot soak phase. */
  isc: number;
}

export interface HfKpis {
  phase: HfPhase;
  cycleIndex: number;
  cyclesTarget: number;
  tModuleC: number | null;
  rhPct: number | null;
  /** Cumulative seconds inside the hot/humid soak band. */
  hotDwellS: number;
  /** Cumulative seconds inside the cold freeze band. */
  coldDwellS: number;
  hotDwellVerdict: DwellVerdict;
  coldDwellVerdict: DwellVerdict;
  rhVerdict: RhVerdict;
  iscGate: IscGateState;
  /** Worst RH excursion observed during hot soak (|RH − 85|). */
  worstRhDevPct: number;
  /** Final pass/fail — `pending` until cycles complete. */
  overallVerdict: DwellVerdict;
}

/**
 * RH may not be reported by every PSU / chamber combo. We expect the
 * orchestrator to push humidity into `LiveReading` as a numeric field —
 * type-safe extension via index signature (we don't modify the shared
 * `LiveReading` type to avoid churn across other tabs).
 */
function readRh(r: LiveReading): number | null {
  const rh = (r as LiveReading & { humidity?: number }).humidity;
  return typeof rh === 'number' ? rh : null;
}

function detectPhase(
  prev: LiveReading | undefined,
  cur: LiveReading,
  cfg: HfConfig,
): HfPhase {
  const t = cur.temperature;
  const rh = readRh(cur);
  if (t === undefined) return 'idle';
  // Hot/humid soak: T in band AND RH in band (or RH unreported with T high).
  if (Math.abs(t - cfg.tHigh) <= HF_CONSTANTS.T_HOT_TOL_C) {
    if (rh === null || Math.abs(rh - cfg.rhHigh) <= HF_CONSTANTS.RH_TOL_PCT) {
      return 'hot-humid-soak';
    }
  }
  if (Math.abs(t - cfg.tLow) <= HF_CONSTANTS.T_COLD_TOL_C) return 'cold-freeze';
  if (!prev || prev.temperature === undefined) return 'idle';
  return t > prev.temperature ? 'transition-up' : 'transition-down';
}

function classifyDwell(actualS: number, minS: number): DwellVerdict {
  if (actualS >= minS) return 'pass';
  if (actualS >= minS * 0.9) return 'warn';
  if (actualS === 0) return 'pending';
  return 'fail';
}

export function computeHfKpis(readings: LiveReading[], cfg: HfConfig): HfKpis {
  if (readings.length === 0) {
    return {
      phase: 'idle',
      cycleIndex: 0,
      cyclesTarget: cfg.cycles,
      tModuleC: null,
      rhPct: null,
      hotDwellS: 0,
      coldDwellS: 0,
      hotDwellVerdict: 'pending',
      coldDwellVerdict: 'pending',
      rhVerdict: 'pending',
      iscGate: 'unknown',
      worstRhDevPct: 0,
      overallVerdict: 'pending',
    };
  }

  const cur = readings[readings.length - 1];
  const prev = readings[readings.length - 2];
  const phase = detectPhase(prev, cur, cfg);
  const rhPct = readRh(cur);

  // Cycle counter: a cycle completes when we transition from cold-freeze
  // band back up across 25 °C (the Isc gate).
  let cycleIndex = 0;
  let inColdBand = false;
  for (let i = 1; i < readings.length; i++) {
    const t = readings[i].temperature;
    const tPrev = readings[i - 1].temperature;
    if (t === undefined || tPrev === undefined) continue;
    if (t <= cfg.tLow + HF_CONSTANTS.T_COLD_TOL_C) inColdBand = true;
    if (inColdBand && tPrev < HF_CONSTANTS.ISC_GATE_C && t >= HF_CONSTANTS.ISC_GATE_C) {
      cycleIndex += 1;
      inColdBand = false;
    }
  }

  // Dwell + RH excursion accumulation
  let hotDwellS = 0;
  let coldDwellS = 0;
  let worstRhDevPct = 0;
  let rhSamplesInHotSoak = 0;
  let rhOutOfBandInHotSoak = 0;
  for (let i = 1; i < readings.length; i++) {
    const a = readings[i - 1];
    const b = readings[i];
    if (b.temperature === undefined) continue;
    const dtSec = (b.timestamp - a.timestamp) / 1000;
    const inHot = Math.abs(b.temperature - cfg.tHigh) <= HF_CONSTANTS.T_HOT_TOL_C;
    const inCold = Math.abs(b.temperature - cfg.tLow) <= HF_CONSTANTS.T_COLD_TOL_C;
    if (inHot) hotDwellS += dtSec;
    if (inCold) coldDwellS += dtSec;
    const rh = readRh(b);
    if (inHot && rh !== null) {
      rhSamplesInHotSoak += 1;
      const dev = Math.abs(rh - cfg.rhHigh);
      if (dev > worstRhDevPct) worstRhDevPct = dev;
      if (dev > HF_CONSTANTS.RH_TOL_PCT) rhOutOfBandInHotSoak += 1;
    }
  }

  // RH verdict per MQT 12.6.2 a — ≤5% out-of-band samples is a pass,
  // 5–20% is warn, >20% fail. If we never reached hot soak yet, pending.
  let rhVerdict: RhVerdict = 'pending';
  if (rhSamplesInHotSoak > 0) {
    const ratio = rhOutOfBandInHotSoak / rhSamplesInHotSoak;
    rhVerdict = ratio <= 0.05 ? 'pass' : ratio <= 0.20 ? 'warn' : 'fail';
  } else if (rhSamplesInHotSoak === 0 && hotDwellS > 0) {
    // We entered hot soak but the chamber doesn't report RH — can't fail
    // on missing data, but warn the operator so they know.
    rhVerdict = 'warn';
  }

  const hotDwellVerdict = classifyDwell(hotDwellS, HF_CONSTANTS.HOT_DWELL_MIN_S);
  const coldDwellVerdict = classifyDwell(coldDwellS, HF_CONSTANTS.COLD_DWELL_MIN_S);

  let iscGate: IscGateState = 'unknown';
  if (cur.temperature !== undefined) {
    iscGate =
      cur.temperature > HF_CONSTANTS.ISC_GATE_C && cfg.isc > 0
        ? 'injecting'
        : 'cooling';
  }

  // Overall: pending until cycles complete; then pass iff every component
  // verdict is at least warn (we don't downgrade to fail on warn-only RH).
  const componentVerdicts: DwellVerdict[] = [hotDwellVerdict, coldDwellVerdict];
  const componentRh: RhVerdict[] = [rhVerdict];
  let overallVerdict: DwellVerdict = 'pending';
  if (cycleIndex >= cfg.cycles) {
    const anyFail = componentVerdicts.some((v) => v === 'fail') || componentRh.some((v) => v === 'fail');
    const anyWarn = componentVerdicts.some((v) => v === 'warn') || componentRh.some((v) => v === 'warn');
    overallVerdict = anyFail ? 'fail' : anyWarn ? 'warn' : 'pass';
  }

  return {
    phase,
    cycleIndex,
    cyclesTarget: cfg.cycles,
    tModuleC: cur.temperature ?? null,
    rhPct,
    hotDwellS,
    coldDwellS,
    hotDwellVerdict,
    coldDwellVerdict,
    rhVerdict,
    iscGate,
    worstRhDevPct,
    overallVerdict,
  };
}

/**
 * Server-side parity helper (matches the TC version). The HF
 * orchestrator MUST call this with the live module temperature before
 * any non-zero SOUR:CURR write — same MQT 11.6.3 a rule.
 */
export function hfIscGateSetpoint(tModuleC: number | null, isc: number): number {
  if (tModuleC === null || tModuleC <= HF_CONSTANTS.ISC_GATE_C) return 0;
  return isc;
}
