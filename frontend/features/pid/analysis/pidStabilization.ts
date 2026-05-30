/**
 * PID stabilization conformity — IEC 61215-2 MQT 21 + IEC TS 62804-1.
 *
 * MQT 21 stabilizes the module under system-voltage bias before the
 * Pmax measurement; the stabilization soak is operator-configurable in the
 * 12–24 h window. AFTER that window the chamber must hold T and RH inside
 * the *tighter* post-stabilization conformity bands (vs the wider tolerance
 * tolerated mid-run while the chamber is still settling). A breach of the
 * post-stabilization band is a hard NON-CONFORM verdict, not an amber warn.
 *
 * Pure helpers only — PidAnalysisPanel.tsx renders the pills/bands and the
 * backend mirror (backend/test_programs/pid_stabilization.py) ships the same
 * constants + clamp + verdict so client and bench cannot drift.
 */

export type StabilizationVerdict = 'conform' | 'non-conform' | 'pending';

export const STABILIZATION_CONSTANTS = {
  /** MQT 21 — stabilization soak is configurable within this window (hours). */
  MIN_STABILIZATION_H: 12,
  MAX_STABILIZATION_H: 24,

  /**
   * Wider in-run tolerances — tolerated WHILE the chamber is settling
   * (mirrors PID_CONSTANTS.T_TOL_C / RH_TOL_PCT used by computePidKpis).
   * TS 62804-1 §6 environmental envelope.
   */
  T_TOL_WIDE_C: 2.0,
  RH_TOL_WIDE_PCT: 5.0,

  /**
   * Tighter post-stabilization tolerances — enforced AFTER the soak window
   * closes, when T/RH must be held flat for the Pmax measurement.
   * MQT 21 conformity / TS 62804-1 §6.2.
   */
  T_TOL_TIGHT_C: 1.0,
  RH_TOL_TIGHT_PCT: 3.0,
} as const;

/** Clamp the operator's stabilization-time input to the MQT 21 [12, 24] h window. */
export function clampStabilizationHours(h: number): number {
  if (Number.isNaN(h)) return STABILIZATION_CONSTANTS.MIN_STABILIZATION_H;
  return Math.min(
    STABILIZATION_CONSTANTS.MAX_STABILIZATION_H,
    Math.max(STABILIZATION_CONSTANTS.MIN_STABILIZATION_H, h),
  );
}

/**
 * Post-stabilization temperature conformity vs setpoint.
 * Conforms when |measT - setT| is within the tight band (inclusive).
 */
export function tempConformity(measT: number | null, setT: number): StabilizationVerdict {
  if (measT === null || Number.isNaN(measT)) return 'pending';
  return Math.abs(measT - setT) <= STABILIZATION_CONSTANTS.T_TOL_TIGHT_C
    ? 'conform'
    : 'non-conform';
}

/**
 * Post-stabilization humidity conformity vs setpoint.
 * Conforms when |measRH - setRH| is within the tight band (inclusive).
 */
export function rhConformity(measRH: number | null, setRH: number): StabilizationVerdict {
  if (measRH === null || Number.isNaN(measRH)) return 'pending';
  return Math.abs(measRH - setRH) <= STABILIZATION_CONSTANTS.RH_TOL_TIGHT_PCT
    ? 'conform'
    : 'non-conform';
}

/**
 * Composite post-stabilization verdict using the tight tolerances.
 *
 * Returns 'pending' until BOTH T and RH have a reading (so the panel shows a
 * neutral state pre-soak). Any tight-band breach on either axis is
 * 'non-conform'; both inside their tight bands is 'conform'.
 */
export function stabilizationVerdict(
  measT: number | null,
  setT: number,
  measRH: number | null,
  setRH: number,
): StabilizationVerdict {
  const t = tempConformity(measT, setT);
  const rh = rhConformity(measRH, setRH);
  if (t === 'pending' || rh === 'pending') return 'pending';
  if (t === 'non-conform' || rh === 'non-conform') return 'non-conform';
  return 'conform';
}
