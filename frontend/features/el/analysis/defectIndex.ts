/**
 * EL defect criteria & DEFECT INDEX — IEC TS 60904-13 + IEA PVPS Task 13.
 *
 * IEC TS 60904-13 specifies the forward-bias electroluminescence (EL)
 * measurement but evaluates the resulting image qualitatively. To turn
 * that qualitative review into a repeatable verdict, this module follows
 * the IEA PVPS Task 13 "Review of Failures of PV Modules" defect
 * catalogue, which groups EL findings into three severity classes:
 *
 *   • Class A — no / minor features with no power-relevant impact
 *   • Class B — moderate features warranting observation (e.g. isolated
 *     cracks, single inactive cell, finger interruptions)
 *   • Class C — severe features (multiple inactive cells / crack networks
 *     / dead areas) with likely power-relevant degradation
 *
 * The DEFECT INDEX collapses the per-class defect counts — weighted by an
 * area factor — into a single 0–100 number (0 = pristine, 100 = fully
 * degraded). Classification thresholds then map the index onto an A/B/C
 * grade. Two threshold sets are encoded:
 *
 *   • DEFAULT — IEC TS 60904-13 review guidance (lenient type-test gate)
 *   • MBJ     — Module Bill-of-Health / Multi-BusBar Junction stricter
 *               acceptance used in high-reliability procurement, where the
 *               grade drops to B/C at a lower index.
 *
 * Pure functions — no React, no I/O, no runtime `@/` imports — so the math
 * tests cleanly in vitest and can be mirrored 1:1 by the backend
 * (backend/test_programs/el_defect.py). Keep the two in lock-step when the
 * standard or the catalogue revises.
 */

/** A/B/C grade from the IEA PVPS Task 13 defect catalogue. */
export type DefectGrade = 'A' | 'B' | 'C';

/** Selectable criteria mode — DEFAULT (IEC review) vs stricter MBJ. */
export type DefectCriteriaMode = 'default' | 'mbj';

/**
 * Per-severity defect counts for one module, as graded by the operator
 * (or an upstream classifier) against the IEA PVPS Task 13 catalogue.
 * `areaFraction` is the fraction of total cell area judged affected by
 * power-relevant defects (0–1); it amplifies the index so a few large
 * dead zones score worse than many pinpoint features.
 */
export interface DefectInput {
  /** Class A — minor/no-impact features. */
  classA: number;
  /** Class B — moderate features (observe). */
  classB: number;
  /** Class C — severe features (reject-candidate). */
  classC: number;
  /** Fraction of cell area affected by power-relevant defects, 0–1. */
  areaFraction: number;
}

/**
 * Severity weights (points per defect) used to build the raw score.
 * Class A is intentionally non-zero-but-small so a pristine module still
 * scores 0 while a module with only minor features scores low-but-nonzero.
 * Per IEA PVPS Task 13 severity ranking C ≫ B > A.
 */
export const DEFECT_WEIGHTS = {
  /** Class A — minor features, negligible power impact. */
  A: 1,
  /** Class B — moderate features, observation grade. */
  B: 5,
  /** Class C — severe features, reject-candidate grade. */
  C: 15,
} as const;

/**
 * Index normalisation. The weighted defect score is divided by
 * SATURATION_SCORE and clamped to [0, 100]; area fraction adds up to
 * AREA_INDEX_MAX index points on top. SATURATION_SCORE = 30 means a
 * module reaches the top of the count-driven band at e.g. two Class-C
 * defects (2 × 15 = 30) before the area term is added.
 */
export const DEFECT_INDEX_NORM = {
  /** Weighted score that maps to 100 on the count axis (before area). */
  SATURATION_SCORE: 30,
  /** Max index contribution from the affected-area term. */
  AREA_INDEX_MAX: 40,
  /** Count axis vs area axis split (count gets 100 − AREA_INDEX_MAX). */
  COUNT_INDEX_MAX: 60,
} as const;

/**
 * Classification thresholds. A module grades:
 *   • A while index ≤ aMax
 *   • B while index ≤ bMax
 *   • C above bMax
 *
 * DEFAULT follows the lenient IEC TS 60904-13 review band; MBJ tightens
 * both cut-points so borderline modules fall a grade lower.
 */
export interface DefectThresholds {
  /** Upper bound (inclusive) of grade A. */
  aMax: number;
  /** Upper bound (inclusive) of grade B; above this ⇒ C. */
  bMax: number;
}

export const DEFECT_THRESHOLDS: Record<DefectCriteriaMode, DefectThresholds> = {
  /** IEC TS 60904-13 review guidance — lenient type-test gate. */
  default: { aMax: 20, bMax: 50 },
  /** MBJ stricter acceptance — drops to B/C at a lower index. */
  mbj: { aMax: 10, bMax: 30 },
} as const;

export interface DefectIndexResult {
  /** Defect index 0 (pristine) – 100 (fully degraded). */
  index: number;
  /** Raw weighted defect score (pre-normalisation). */
  weightedScore: number;
  /** Index contribution from the defect-count axis. */
  countComponent: number;
  /** Index contribution from the affected-area axis. */
  areaComponent: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Compute the EL DEFECT INDEX (0–100) from per-class defect counts and the
 * affected-area fraction. Deterministic and side-effect free.
 *
 * The index is the sum of two clamped components:
 *   countComponent = COUNT_INDEX_MAX × min(1, weightedScore / SATURATION_SCORE)
 *   areaComponent  = AREA_INDEX_MAX  × clamp(areaFraction, 0, 1)
 * where weightedScore = A·wA + B·wB + C·wC.
 */
export function computeDefectIndex(defects: DefectInput): DefectIndexResult {
  const classA = Math.max(0, defects.classA);
  const classB = Math.max(0, defects.classB);
  const classC = Math.max(0, defects.classC);
  const area = clamp(defects.areaFraction, 0, 1);

  const weightedScore =
    classA * DEFECT_WEIGHTS.A +
    classB * DEFECT_WEIGHTS.B +
    classC * DEFECT_WEIGHTS.C;

  const countComponent =
    DEFECT_INDEX_NORM.COUNT_INDEX_MAX *
    Math.min(1, weightedScore / DEFECT_INDEX_NORM.SATURATION_SCORE);

  const areaComponent = DEFECT_INDEX_NORM.AREA_INDEX_MAX * area;

  const index = clamp(countComponent + areaComponent, 0, 100);

  return { index, weightedScore, countComponent, areaComponent };
}

/**
 * Map a defect index onto an A/B/C grade using the selected criteria mode.
 * Boundaries are inclusive on the lower grade (index === aMax ⇒ 'A').
 */
export function classifyDefectIndex(
  index: number,
  mode: DefectCriteriaMode = 'default',
): DefectGrade {
  const t = DEFECT_THRESHOLDS[mode];
  if (index <= t.aMax) return 'A';
  if (index <= t.bMax) return 'B';
  return 'C';
}

/** Human-readable, IEC/IEA-cited label for a grade + mode. */
export function describeGrade(grade: DefectGrade, mode: DefectCriteriaMode): string {
  const set = mode === 'mbj' ? 'MBJ strict' : 'IEC TS 60904-13';
  switch (grade) {
    case 'A':
      return `Grade A — pass (${set})`;
    case 'B':
      return `Grade B — observe (${set})`;
    case 'C':
      return `Grade C — reject (${set})`;
  }
}
