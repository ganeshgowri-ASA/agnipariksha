/**
 * Ground / Equipotential continuity dual-path analysis — IEC 61730-2 MST 13.
 *
 * MST 13 requires that the resistance between any exposed conductive part
 * (frame, mounting hole, junction box) and the main grounding terminal be
 * below 0.1 Ω while a defined bonding current (nominally 25 A) is injected.
 * A single resistance reading is not enough for an audit: this module logs
 * BOTH the shortest and the longest conductive path measured in a run and
 * grades each one, plus the injected frame current against a tolerance band
 * around the 25 A nominal.
 *
 * The dual-path log can be attributed to the calling context — Ground
 * continuity is a cross-cutting check exercised under COP (Conditioning /
 * Outdoor Performance), DPTT (Dynamic / Partial-load Thermal Test), LeTID
 * and IDD (Insulation / Dielectric / wet-leakage) sequences — so the
 * verdict carries which context requested it.
 *
 * Pure functions, no React, no I/O. Tested under vitest in dualPath.test.ts.
 * Mirrors the shape of tcAnalysis.ts / rcoAnalysis.ts, and is kept in lock-
 * step with backend/test_programs/ground_continuity.py (same constants +
 * path_resistance_verdict + frame_current_in_band + dual_path_verdict) so
 * the client display and the bench orchestrator never disagree on a verdict.
 */

/** Overall MST 13 dual-path verdict labels. */
export type DualPathVerdict = 'conform' | 'non-conform' | 'pending';

/** Per-path resistance verdict labels. */
export type PathVerdict = 'conform' | 'non-conform';

/**
 * Calling context the dual-path continuity log is attributed to. Ground
 * continuity per MST 13 is reused across these sequences, so the verdict
 * records which one requested the injection.
 */
export type GcContext = 'COP' | 'DPTT' | 'LeTID' | 'IDD';

/** Human-readable expansion of each context, shown in the UI / report. */
export const GC_CONTEXT_LABELS: Record<GcContext, string> = {
  COP: 'Conditioning / Outdoor Performance',
  DPTT: 'Dynamic / Partial-load Thermal Test',
  LeTID: 'LeTID sequence',
  IDD: 'Insulation / Dielectric (wet-leakage)',
} as const;

/** All selectable contexts, in display order (drives the UI selector). */
export const GC_CONTEXTS: readonly GcContext[] = ['COP', 'DPTT', 'LeTID', 'IDD'] as const;

/**
 * MST 13 constants. Pinned alongside the backend orchestrator in
 * backend/test_programs/ground_continuity.py — update both files together.
 */
export const DUAL_PATH_CONSTANTS = {
  /**
   * MST 13 — resistance between any conductive part and ground shall be
   * below 0.1 Ω. The boundary itself (exactly 0.1 Ω) is treated as
   * NON-CONFORM: the criterion is strictly less-than for safety margin.
   */
  MST13_MAX_R_OHM: 0.1,
  /** MST 13 — nominal bonding/frame test current (A). */
  NOMINAL_FRAME_CURRENT_A: 25.0,
  /**
   * Tolerance band (± fraction) around the nominal frame current. The
   * injected current must land inside [nominal·(1−band), nominal·(1+band)]
   * for the run to be valid; out-of-band current invalidates the reading.
   */
  FRAME_CURRENT_TOL_FRAC: 0.1,
} as const;

/** Lower bound of the valid frame-current band (A). */
export const FRAME_CURRENT_MIN_A =
  DUAL_PATH_CONSTANTS.NOMINAL_FRAME_CURRENT_A * (1 - DUAL_PATH_CONSTANTS.FRAME_CURRENT_TOL_FRAC);

/** Upper bound of the valid frame-current band (A). */
export const FRAME_CURRENT_MAX_A =
  DUAL_PATH_CONSTANTS.NOMINAL_FRAME_CURRENT_A * (1 + DUAL_PATH_CONSTANTS.FRAME_CURRENT_TOL_FRAC);

/**
 * Grade a single path resistance against the MST 13 limit.
 *
 * Strictly less-than 0.1 Ω is CONFORM; the boundary and above are
 * NON-CONFORM. Non-finite / negative readings are treated as NON-CONFORM
 * (a missing or impossible measurement cannot prove conformity).
 */
export function pathResistanceVerdict(rOhm: number): PathVerdict {
  if (!Number.isFinite(rOhm) || rOhm < 0) return 'non-conform';
  return rOhm < DUAL_PATH_CONSTANTS.MST13_MAX_R_OHM ? 'conform' : 'non-conform';
}

/**
 * Check that the injected frame current is within the ± tolerance band of
 * the 25 A nominal (MST 13). The band is inclusive of both endpoints.
 * Non-finite values are out of band.
 */
export function frameCurrentInBand(amps: number): boolean {
  if (!Number.isFinite(amps)) return false;
  return amps >= FRAME_CURRENT_MIN_A && amps <= FRAME_CURRENT_MAX_A;
}

export interface DualPathInput {
  /** Measured resistance of the shortest conductive path (Ω), or null. */
  shortestR: number | null;
  /** Measured resistance of the longest conductive path (Ω), or null. */
  longestR: number | null;
  /** Injected frame/bonding current for this run (A), or null. */
  injectedA: number | null;
}

/**
 * Compose the overall MST 13 dual-path verdict.
 *
 * `pending` until all three inputs (both path resistances and the injected
 * current) are present. Once present: NON-CONFORM if EITHER path is at/above
 * the 0.1 Ω limit OR the injected current is outside the tolerance band;
 * otherwise CONFORM.
 */
export function dualPathVerdict({ shortestR, longestR, injectedA }: DualPathInput): DualPathVerdict {
  if (shortestR === null || longestR === null || injectedA === null) return 'pending';
  const currentOk = frameCurrentInBand(injectedA);
  const shortestOk = pathResistanceVerdict(shortestR) === 'conform';
  const longestOk = pathResistanceVerdict(longestR) === 'conform';
  return currentOk && shortestOk && longestOk ? 'conform' : 'non-conform';
}
