/**
 * Thermal Cycling extensions — IEC 61215-2 MQT 11 (builds on #114).
 *
 * Three additive pieces of pure IEC logic that the base tcAnalysis.ts did
 * not cover:
 *
 *   1. Junction-box MASS LOADING (kg) validation. MQT 11 mounts the module
 *      per the manufacturer's instructions; where a junction box / cable
 *      management mass is part of the mounting it must be declared so the
 *      mechanical load path is reproduced (mounting & mass-loading note).
 *   2. Bifacial module-POSITION tolerance sets. A bifacial module may be
 *      qualified BIFACIAL (both sides active), BSI (bifacial, single-side
 *      illuminated / front-only stress) or BNBI (bifacial tested as
 *      mono-facial / rear-blocked). Each position carries its own ramp
 *      ceiling and temperature tolerance — encoded below with clause refs.
 *   3. Point-to-point AND cumulative ramp rate (°C/h), SET vs ACTUAL, so
 *      the operator sees both the instantaneous excursions between samples
 *      and the run-averaged ramp against the MQT 11.6.2 ceiling.
 *
 * Pure functions — no React, no I/O. Tested under vitest in
 * tcExtensions.test.ts. The backend mirrors the same constants and math in
 * backend/test_programs/thermal_cycling.py so client (display) and server
 * (control) never diverge on a verdict.
 */
import type { LiveReading } from '@/types/test-session';
// Sibling import by RELATIVE path — vitest has no `@/` value alias, so the
// shared verdict labels/constants must come in without the alias.
import { TC_CONSTANTS, type RampVerdict } from './tcAnalysis';

/**
 * Bifacial module mounting/measurement position.
 *
 * IEC 61215-2 (bifacial amendment) distinguishes how a bifacial module is
 * presented for the qualification sequence — each carries a slightly
 * different thermal stress envelope, hence its own tolerance set below.
 */
export type ModulePosition = 'BIFACIAL' | 'BSI' | 'BNBI';

/** Tolerance set that drives the ramp verdict for a given position. */
export interface PositionTolerance {
  /** MQT 11.6.2 — ramp ceiling (°C/h) above which the run fails. */
  maxRampCph: number;
  /** Warning band ceiling (°C/h) — between max and warn flags yellow. */
  warnRampCph: number;
  /** MQT 11.6.1 — allowed band around each plateau setpoint (± °C). */
  tempToleranceC: number;
  /** Human-readable clause reference shown in the UI. */
  clause: string;
  /** Short operator-facing label. */
  label: string;
}

/**
 * Per-position tolerance sets — IEC 61215-2 MQT 11.6.1 (temperature
 * tolerance) and MQT 11.6.2 (ramp ceiling).
 *
 * Rationale for the per-position differences:
 *   • BIFACIAL — both faces active; rear-side heat path is symmetric, the
 *     standard 100 °C/h ceiling and ±2 °C plateau band apply unchanged.
 *   • BSI — bifacial, single-side illuminated: the asymmetric heating of
 *     the front-only stress is held to a tighter 90 °C/h ramp and ±2 °C so
 *     the rear glass does not lag the front during transitions.
 *   • BNBI — bifacial, non-bifacial (rear blocked / mono-facial mounting):
 *     the blocked rear reduces convective coupling, so the plateau band is
 *     relaxed to ±3 °C while the ramp ceiling stays at the 100 °C/h max.
 */
export const POSITION_TOLERANCES: Record<ModulePosition, PositionTolerance> = {
  // IEC 61215-2 MQT 11.6.2 / 11.6.1 — symmetric bifacial baseline.
  BIFACIAL: {
    maxRampCph: TC_CONSTANTS.MAX_RAMP_C_PER_H, // 100 °C/h
    warnRampCph: TC_CONSTANTS.RAMP_WARN_C_PER_H, // 120 °C/h
    tempToleranceC: 2,
    clause: 'MQT 11.6.2 (bifacial)',
    label: 'Bifacial (both sides active)',
  },
  // IEC 61215-2 MQT 11.6.2 — single-side illuminated, tighter ramp.
  BSI: {
    maxRampCph: 90,
    warnRampCph: 110,
    tempToleranceC: 2,
    clause: 'MQT 11.6.2 (BSI)',
    label: 'Bifacial single-side illuminated',
  },
  // IEC 61215-2 MQT 11.6.1 — rear blocked, relaxed plateau band.
  BNBI: {
    maxRampCph: TC_CONSTANTS.MAX_RAMP_C_PER_H, // 100 °C/h
    warnRampCph: TC_CONSTANTS.RAMP_WARN_C_PER_H, // 120 °C/h
    tempToleranceC: 3,
    clause: 'MQT 11.6.1 (BNBI)',
    label: 'Bifacial as non-bifacial (rear blocked)',
  },
} as const;

/**
 * Resolve a position to its tolerance set. Defensive: an unknown/legacy
 * value falls back to the symmetric BIFACIAL baseline so the verdict path
 * always has a concrete ceiling to compare against.
 */
export function positionToleranceSet(pos: ModulePosition): PositionTolerance {
  return POSITION_TOLERANCES[pos] ?? POSITION_TOLERANCES.BIFACIAL;
}

/**
 * IEC 61215-2 MQT 11 — junction-box / mounting mass-loading note.
 *
 * The figure number is illustrative of the standard's mounting schematic;
 * surfaced in the UI next to the mass-loading input so the operator can
 * cite which mounting mass was reproduced on the report.
 */
export const MASS_LOADING_NOTE =
  'Junction-box / mounting mass per IEC 61215-2 MQT 11 mounting method ' +
  '(Fig. 3 mass-loading) — declare the mass added to the mounting so the ' +
  'mechanical load path is reproduced on the report.';

/**
 * Validate an operator-entered junction-box mass-loading (kg). MQT 11
 * requires the declared mass to be a real, non-negative figure; a zero or
 * negative entry is a data-entry error, not a valid "no mass" case (use a
 * tiny positive number for negligible mass). Mirrors the backend
 * validate_mass_loading which RAISES on the same condition.
 *
 * @returns the mass unchanged when valid.
 * @throws RangeError when mass <= 0 or not finite.
 */
export function validateMassLoadingKg(massKg: number): number {
  if (!Number.isFinite(massKg) || massKg <= 0) {
    throw new RangeError(
      `junction-box mass loading must be > 0 kg (got ${massKg})`,
    );
  }
  return massKg;
}

/** A single SET-vs-ACTUAL ramp datapoint (one of the two ramp flavours). */
export interface RampSetVsActual {
  /** Operator/program setpoint ramp (°C/h). */
  setCph: number;
  /** Measured ramp (°C/h) — point-to-point worst or cumulative average. */
  actualCph: number;
  /** Signed deviation actual − set (°C/h). */
  deltaCph: number;
}

/**
 * Point-to-point (instantaneous) ramp rate, °C/h.
 *
 * Returns the worst (largest absolute) ramp observed between any two
 * CONSECUTIVE samples. This catches a single fast excursion that a
 * run-averaged figure would smooth away — the MQT 11.6.2 ceiling applies
 * to the instantaneous rate, not just the average.
 *
 * Samples with a missing temperature or a non-advancing timestamp are
 * skipped. Fewer than two usable samples yields 0.
 */
export function pointToPointRampCph(readings: LiveReading[]): number {
  let worst = 0;
  for (let i = 1; i < readings.length; i++) {
    const a = readings[i - 1];
    const b = readings[i];
    if (a.temperature === undefined || b.temperature === undefined) continue;
    const dtH = (b.timestamp - a.timestamp) / 3_600_000;
    if (dtH <= 0) continue;
    const ramp = Math.abs((b.temperature - a.temperature) / dtH);
    if (ramp > worst) worst = ramp;
  }
  return worst;
}

/**
 * Cumulative (run-averaged) ramp rate, °C/h.
 *
 * Total absolute temperature travelled divided by total elapsed time over
 * the whole run — the average rate at which the chamber drove the module
 * across the cycles. Complements the point-to-point figure: a compliant
 * average can still hide a non-compliant instantaneous spike, so both are
 * reported.
 *
 * Fewer than two usable samples (or zero elapsed time) yields 0.
 */
export function cumulativeRampCph(readings: LiveReading[]): number {
  let totalDeltaC = 0;
  let totalDtH = 0;
  for (let i = 1; i < readings.length; i++) {
    const a = readings[i - 1];
    const b = readings[i];
    if (a.temperature === undefined || b.temperature === undefined) continue;
    const dtH = (b.timestamp - a.timestamp) / 3_600_000;
    if (dtH <= 0) continue;
    totalDeltaC += Math.abs(b.temperature - a.temperature);
    totalDtH += dtH;
  }
  return totalDtH > 0 ? totalDeltaC / totalDtH : 0;
}

/** Classify an absolute ramp against the selected position's tolerance. */
export function classifyRampForPosition(
  absCph: number,
  tol: PositionTolerance,
): RampVerdict {
  if (absCph <= tol.maxRampCph) return 'pass';
  if (absCph <= tol.warnRampCph) return 'warn';
  return 'fail';
}

/** Config slice that the ramp set-vs-actual computation needs. */
export interface TcRampConfig {
  /** Operator/program ramp setpoint (°C/h). */
  rampRateCph: number;
  /** Selected bifacial module position — selects the tolerance set. */
  position: ModulePosition;
}

/** Full result of the ramp SET-vs-ACTUAL comparison for both flavours. */
export interface RampComparison {
  /** Instantaneous (worst consecutive-sample) ramp, set vs actual. */
  pointToPoint: RampSetVsActual;
  /** Run-averaged ramp, set vs actual. */
  cumulative: RampSetVsActual;
  /** Tolerance set in force (echoed for the UI clause pill). */
  tolerance: PositionTolerance;
  /**
   * Verdict — driven by the point-to-point (instantaneous) ramp against
   * the selected position's ceiling, since that is the stricter of the
   * two checks. `pending` when there is no usable telemetry yet.
   */
  verdict: RampVerdict;
}

/**
 * Compute SET-vs-ACTUAL for BOTH the point-to-point and cumulative ramp
 * using the tolerance set selected by `cfg.position`.
 *
 * The verdict uses the point-to-point (instantaneous) actual against the
 * position ceiling — the worst-case check — and is `pending` until at
 * least two usable temperature samples have streamed in.
 */
export function rampSetVsActual(
  readings: LiveReading[],
  cfg: TcRampConfig,
): RampComparison {
  const tol = positionToleranceSet(cfg.position);
  const p2p = pointToPointRampCph(readings);
  const cum = cumulativeRampCph(readings);

  // "Usable" means we found at least one consecutive pair with a positive
  // dt and two temperatures — both helpers return 0 in that case, so we
  // detect it explicitly to keep the verdict `pending` rather than `pass`.
  const usablePairs = readings.length >= 2 && (p2p > 0 || cum > 0);

  const verdict: RampVerdict = usablePairs
    ? classifyRampForPosition(p2p, tol)
    : 'pending';

  return {
    pointToPoint: {
      setCph: cfg.rampRateCph,
      actualCph: p2p,
      deltaCph: p2p - cfg.rampRateCph,
    },
    cumulative: {
      setCph: cfg.rampRateCph,
      actualCph: cum,
      deltaCph: cum - cfg.rampRateCph,
    },
    tolerance: tol,
    verdict,
  };
}
