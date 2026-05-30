/**
 * Reverse Current Overload — forward-bias hold + thermal helpers.
 * IEC 61730-2 MST 26 (Reverse Current Overload Test).
 *
 * MST 26 sources a fault current of 1.35× the module's rated short-circuit
 * current (Isc) through the sample in the *forward* direction and holds it
 * for a configured soak (the standard allows a 1–2 h hold depending on lab
 * practice). Throughout the hold an IR camera and surface thermocouples
 * watch for hot-spots / overheating — the sample fails if any surface
 * exceeds the ignition-margin ceiling.
 *
 * Pure functions, no React, no I/O. Tested under vitest in
 * rcoThermal.test.ts. Mirrors the constants pinned in the backend
 * orchestrator (backend/test_programs/reverse_current.py) — update both
 * files together. Cross-`@/` imports are `import type` only; siblings are
 * relative.
 */
import type { LiveReading } from '@/types/test-session';
import type { Verdict } from './rcoAnalysis';

/**
 * MST 26 forward-bias + thermal constants. Pinned alongside the backend
 * orchestrator (backend/test_programs/reverse_current.py) so the forward
 * setpoint and hold bounds cannot drift between client and server.
 */
export const RCO_THERMAL_CONSTANTS = {
  /** MST 26 §6 — forward-bias fault current = 1.35× rated Isc. */
  ISC_FORWARD_MULTIPLIER: 1.35,
  /** MST 26 §6 — minimum forward-bias hold (h). */
  HOLD_MIN_H: 1,
  /** MST 26 §6 — maximum forward-bias hold (h). */
  HOLD_MAX_H: 2,
  /** Surface temperature ceiling (°C) above which the sample FAILs (ignition margin). */
  T_CEILING_C: 90.0,
  /** Warning band — within this margin (°C) of the ceiling flags yellow. */
  T_WARN_MARGIN_C: 10.0,
} as const;

/** A single module-surface temperature sample from a thermocouple channel. */
export interface ModuleTempReading {
  /** Epoch ms. */
  timestamp: number;
  /** Surface temperature (°C). */
  tempC: number;
}

/** One point of the module-temperature time series for the chart. */
export interface ModuleTempPoint {
  /** Minutes since the first sample. */
  tMin: number;
  /** Surface temperature (°C). */
  tempC: number;
}

export interface ModuleTempTrace {
  points: ModuleTempPoint[];
  /** Worst (highest) surface temperature seen (°C). null when no samples. */
  peakC: number | null;
  /** Verdict vs the MST 26 surface ceiling. */
  verdict: Verdict;
}

/**
 * MST 26 §6 — forward-bias setpoint. Returns the fault current to source
 * through the module, i.e. 1.35× the rated short-circuit current.
 *
 * @param isc rated module short-circuit current (A).
 * @returns the 1.35×Isc forward-bias setpoint (A).
 */
export function forwardBiasSetpoint(isc: number): number {
  return isc * RCO_THERMAL_CONSTANTS.ISC_FORWARD_MULTIPLIER;
}

/**
 * Clamp the operator's forward-bias hold to the MST 26 §6 window [1, 2] h.
 *
 * The UI constrains the input, but a misbehaving caller (CLI, replay) could
 * still pass an out-of-range value. We clamp defensively so the bench never
 * holds for less than 1 h or more than 2 h. NaN falls back to the minimum.
 *
 * @param hours requested hold (h).
 * @returns hold clamped to [HOLD_MIN_H, HOLD_MAX_H].
 */
export function clampHoldHours(hours: number): number {
  if (Number.isNaN(hours)) return RCO_THERMAL_CONSTANTS.HOLD_MIN_H;
  return Math.min(
    Math.max(hours, RCO_THERMAL_CONSTANTS.HOLD_MIN_H),
    RCO_THERMAL_CONSTANTS.HOLD_MAX_H,
  );
}

/** Classify a peak surface temperature against the MST 26 ceiling. */
function classifySurfaceTemp(peakC: number): Verdict {
  const { T_CEILING_C, T_WARN_MARGIN_C } = RCO_THERMAL_CONSTANTS;
  if (peakC >= T_CEILING_C) return 'fail';
  if (peakC >= T_CEILING_C - T_WARN_MARGIN_C) return 'warn';
  return 'pass';
}

/**
 * Build the module-temperature trace (temperature vs time) from a stream of
 * thermocouple samples and derive the overheat verdict. Accepts either the
 * dedicated {@link ModuleTempReading} shape or the shared {@link LiveReading}
 * (whose optional `temperature` field carries the surface temperature).
 *
 * @returns chart points (minutes since start), the peak surface temperature,
 *          and the verdict vs the MST 26 ceiling (`pending` with no samples).
 */
export function moduleTempTrace(
  readings: ReadonlyArray<ModuleTempReading | LiveReading>,
): ModuleTempTrace {
  const samples: ModuleTempReading[] = [];
  for (const r of readings) {
    const t = 'tempC' in r ? r.tempC : r.temperature;
    if (t === undefined || t === null) continue;
    samples.push({ timestamp: r.timestamp, tempC: t });
  }

  if (samples.length === 0) {
    return { points: [], peakC: null, verdict: 'pending' };
  }

  const t0 = samples[0].timestamp;
  let peakC = -Infinity;
  const points = samples.map((s) => {
    if (s.tempC > peakC) peakC = s.tempC;
    return { tMin: (s.timestamp - t0) / 60000, tempC: s.tempC };
  });

  return { points, peakC, verdict: classifySurfaceTemp(peakC) };
}
