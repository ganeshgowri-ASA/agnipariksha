/**
 * Thermal Cycling analysis — IEC 61215-2 MQT 11.
 *
 * Derives the IEC-mandated KPIs from a stream of live readings:
 *   - cycle index (completed full hot↔cold cycles)
 *   - current phase (HEATING / HOT_DWELL / COOLING / COLD_DWELL / IDLE)
 *   - instantaneous and rolling ramp rate (°C/h)
 *   - ramp-rate compliance vs the 100 °C/h ceiling (MQT 11.6.2)
 *   - Isc-gate state (current shall only be injected when T_module > 25 °C,
 *     MQT 11.6.3 a)
 *   - per-cycle ramp-rate verdict + worst observed ramp
 *
 * Pure functions — no React, no I/O. Tested under vitest in
 * tcAnalysis.test.ts. The visual layer (TcAnalysisPanel) consumes the
 * return values; the bench orchestrator (backend) also uses the same
 * math for the Isc gate so client/server stay in sync.
 */
import type { LiveReading } from '@/types/test-session';

/** IEC 61215-2 MQT 11 verdict labels. */
export type RampVerdict = 'pass' | 'warn' | 'fail' | 'pending';
export type IscGateState = 'injecting' | 'cooling' | 'unknown';
export type TcPhase = 'idle' | 'heating' | 'hot-dwell' | 'cooling' | 'cold-dwell';

/** IEC clauses encoded as constants so verdicts can cite the source. */
export const TC_CONSTANTS = {
  /** MQT 11.6.2 — temperature change rate shall not exceed 100 °C/h. */
  MAX_RAMP_C_PER_H: 100,
  /** Warning band — readings between 100 and 120 °C/h flag yellow. */
  RAMP_WARN_C_PER_H: 120,
  /** MQT 11.6.3 a — Isc applied only when T_module > 25 °C. */
  ISC_GATE_C: 25,
  /** MQT 11.6.2 — minimum dwell at each extreme. */
  MIN_DWELL_S: 10 * 60,
  /** Default qualification cycle count. */
  DEFAULT_CYCLES: 200,
} as const;

export interface TcConfig {
  /** Target cycle count (operator setpoint). */
  cycles: number;
  /** Hot plateau °C (typ. +85). */
  tMax: number;
  /** Cold plateau °C (typ. −40). */
  tMin: number;
  /** Operator-configured ramp rate °C/h (clamped to 100 in the orchestrator). */
  rampRateCph: number;
  /** Isc setpoint (A) for the heating phase. */
  isc: number;
}

export interface TcKpis {
  phase: TcPhase;
  cycleIndex: number;
  cyclesTarget: number;
  /** Last observed module temperature (°C). null if no readings yet. */
  tModuleC: number | null;
  /** Most recent instantaneous ramp rate (°C/h) over a 60s sliding window. */
  rampRateCph: number;
  /** Worst (highest absolute) ramp rate seen in the entire run. */
  worstRampCph: number;
  rampVerdict: RampVerdict;
  iscGate: IscGateState;
  /** Cumulative seconds inside the hot dwell band (T ≥ tMax − 2). */
  hotDwellS: number;
  /** Cumulative seconds inside the cold dwell band (T ≤ tMin + 2). */
  coldDwellS: number;
  /** Final pass/fail verdict — `pending` until cycles complete. */
  overallVerdict: RampVerdict;
}

/**
 * Window for the rolling ramp-rate calculation. 60 s smooths over the
 * MQT thermocouple sampling jitter without lagging the actual ramp.
 */
const RAMP_WINDOW_MS = 60_000;

function classifyRamp(absCph: number): RampVerdict {
  if (absCph <= TC_CONSTANTS.MAX_RAMP_C_PER_H) return 'pass';
  if (absCph <= TC_CONSTANTS.RAMP_WARN_C_PER_H) return 'warn';
  return 'fail';
}

function detectPhase(
  prev: LiveReading | undefined,
  cur: LiveReading,
  cfg: TcConfig,
): TcPhase {
  const t = cur.temperature;
  if (t === undefined) return 'idle';
  if (t >= cfg.tMax - 2) return 'hot-dwell';
  if (t <= cfg.tMin + 2) return 'cold-dwell';
  if (!prev || prev.temperature === undefined) return 'idle';
  return t > prev.temperature ? 'heating' : 'cooling';
}

/**
 * Walks the entire readings array and produces the current KPI snapshot.
 *
 * Designed to be cheap to call on every WS tick — O(n) over readings but
 * n is bounded by the WS buffer (~10 Hz × test duration). For multi-hour
 * runs the caller should memoise on `readings.length`.
 */
export function computeTcKpis(
  readings: LiveReading[],
  cfg: TcConfig,
): TcKpis {
  if (readings.length === 0) {
    return {
      phase: 'idle',
      cycleIndex: 0,
      cyclesTarget: cfg.cycles,
      tModuleC: null,
      rampRateCph: 0,
      worstRampCph: 0,
      rampVerdict: 'pending',
      iscGate: 'unknown',
      hotDwellS: 0,
      coldDwellS: 0,
      overallVerdict: 'pending',
    };
  }

  const cur = readings[readings.length - 1];
  const prev = readings[readings.length - 2];
  const phase = detectPhase(prev, cur, cfg);

  // Rolling ramp rate over the last RAMP_WINDOW_MS — pick the oldest
  // reading whose timestamp is within the window.
  let windowStart = readings.length - 1;
  while (
    windowStart > 0 &&
    cur.timestamp - readings[windowStart - 1].timestamp < RAMP_WINDOW_MS
  ) {
    windowStart -= 1;
  }
  const ref = readings[windowStart];
  const dtH = (cur.timestamp - ref.timestamp) / 3_600_000;
  const dT =
    cur.temperature !== undefined && ref.temperature !== undefined
      ? cur.temperature - ref.temperature
      : 0;
  const rampRateCph = dtH > 0 ? dT / dtH : 0;

  // Cycle counter: count zero-crossings of (T - midpoint) on the rising edge.
  // A "cycle" is one complete hot→cold→hot sweep in IEC vocabulary.
  const midpoint = (cfg.tMax + cfg.tMin) / 2;
  let cycleIndex = 0;
  let crossedUp = false;
  for (let i = 1; i < readings.length; i++) {
    const a = readings[i - 1].temperature;
    const b = readings[i].temperature;
    if (a === undefined || b === undefined) continue;
    if (a < midpoint && b >= midpoint) {
      if (crossedUp) cycleIndex += 1;
      crossedUp = true;
    }
  }

  // Cumulative dwell totals (s)
  let hotDwellS = 0;
  let coldDwellS = 0;
  let worstRampCph = 0;
  for (let i = 1; i < readings.length; i++) {
    const a = readings[i - 1];
    const b = readings[i];
    if (b.temperature === undefined) continue;
    const dtSec = (b.timestamp - a.timestamp) / 1000;
    if (b.temperature >= cfg.tMax - 2) hotDwellS += dtSec;
    if (b.temperature <= cfg.tMin + 2) coldDwellS += dtSec;
    if (a.temperature !== undefined) {
      const localDtH = (b.timestamp - a.timestamp) / 3_600_000;
      if (localDtH > 0) {
        const localRamp = Math.abs((b.temperature - a.temperature) / localDtH);
        if (localRamp > worstRampCph) worstRampCph = localRamp;
      }
    }
  }

  // Isc-gate: current is "injecting" iff module temperature exceeds the
  // IEC threshold AND the operator-configured Isc > 0. Otherwise "cooling".
  let iscGate: IscGateState = 'unknown';
  if (cur.temperature !== undefined) {
    iscGate =
      cur.temperature > TC_CONSTANTS.ISC_GATE_C && cfg.isc > 0
        ? 'injecting'
        : 'cooling';
  }

  const rampVerdict = classifyRamp(Math.abs(rampRateCph));
  const overallVerdict: RampVerdict =
    cycleIndex < cfg.cycles
      ? 'pending'
      : worstRampCph > TC_CONSTANTS.RAMP_WARN_C_PER_H
        ? 'fail'
        : worstRampCph > TC_CONSTANTS.MAX_RAMP_C_PER_H
          ? 'warn'
          : 'pass';

  return {
    phase,
    cycleIndex,
    cyclesTarget: cfg.cycles,
    tModuleC: cur.temperature ?? null,
    rampRateCph,
    worstRampCph,
    rampVerdict,
    iscGate,
    hotDwellS,
    coldDwellS,
    overallVerdict,
  };
}

/**
 * Server-side parity helper. The backend orchestrator MUST call this with
 * the live module temperature before sending any non-zero SOUR:CURR
 * write — if the gate returns 0, the SCPI write must be `SOUR:CURR 0`
 * regardless of the configured Isc setpoint. Encoded as a pure function
 * so both client (display) and server (control) draw the same conclusion.
 *
 * @returns the safe current setpoint (0 A if gate closed, configured isc
 *          otherwise).
 */
export function iscGateSetpoint(tModuleC: number | null, isc: number): number {
  if (tModuleC === null || tModuleC <= TC_CONSTANTS.ISC_GATE_C) return 0;
  return isc;
}
