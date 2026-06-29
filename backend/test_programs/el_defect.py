"""Electroluminescence defect criteria & DEFECT INDEX —
IEC TS 60904-13 + IEA PVPS Task 13 defect catalogue.

IEC TS 60904-13 specifies the forward-bias EL measurement but evaluates
the image qualitatively. To make that verdict repeatable, this module
follows the IEA PVPS Task 13 "Review of Failures of PV Modules" defect
catalogue, which groups EL findings into three severity classes:

    Class A — no / minor features, no power-relevant impact
    Class B — moderate features (isolated crack, single inactive cell,
              finger interruptions) → observation grade
    Class C — severe features (multiple inactive cells / crack networks /
              dead areas) → reject-candidate grade

The DEFECT INDEX collapses the per-class counts — weighted by an affected
area factor — into a single 0–100 number (0 = pristine, 100 = fully
degraded). Classification thresholds then map the index to an A/B/C grade.
Two threshold sets are encoded:

    DEFAULT — IEC TS 60904-13 review guidance (lenient type-test gate)
    MBJ     — Module Bill-of-Health / Multi-BusBar Junction stricter
              acceptance used in high-reliability procurement.

These are pure functions mirrored 1:1 on the frontend in
``frontend/features/el/analysis/defectIndex.ts`` (DEFECT_WEIGHTS,
DEFECT_INDEX_NORM, DEFECT_THRESHOLDS). Update both files together when the
standard or the catalogue revises so the dashboard verdict and any
server-side report cannot drift.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

# --- IEC TS 60904-13 / IEA PVPS Task 13 constants -----------------------

# Severity weights (points per defect). Class A is small-but-nonzero so a
# pristine module scores 0 while a minor-only module scores low. C >> B > A
# per the IEA PVPS Task 13 severity ranking. Mirrors DEFECT_WEIGHTS on the
# frontend.
DEFECT_WEIGHT_A = 1.0
DEFECT_WEIGHT_B = 5.0
DEFECT_WEIGHT_C = 15.0

# Index normalisation. Mirrors DEFECT_INDEX_NORM on the frontend.
SATURATION_SCORE = 30.0   # weighted score that maxes the count axis
AREA_INDEX_MAX = 40.0     # max index from the affected-area term
COUNT_INDEX_MAX = 60.0    # max index from the defect-count term

# Classification thresholds per criteria mode. A while index <= a_max,
# B while index <= b_max, C above b_max. Mirrors DEFECT_THRESHOLDS.
DefectMode = Literal["default", "mbj"]

DEFECT_THRESHOLDS: dict[str, tuple[float, float]] = {
    # IEC TS 60904-13 review guidance — lenient type-test gate. (a_max, b_max)
    "default": (20.0, 50.0),
    # MBJ stricter acceptance — drops to B/C at a lower index.
    "mbj": (10.0, 30.0),
}


@dataclass(frozen=True)
class DefectIndexResult:
    """Outcome of :func:`compute_defect_index`."""

    index: float            # 0 (pristine) – 100 (fully degraded)
    weighted_score: float   # raw A·wA + B·wB + C·wC
    count_component: float  # index contribution from the count axis
    area_component: float   # index contribution from the area axis


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def compute_defect_index(
    class_a: int,
    class_b: int,
    class_c: int,
    area_fraction: float,
) -> DefectIndexResult:
    """Compute the EL DEFECT INDEX (0–100).

    Args:
        class_a: count of Class-A (minor) features.
        class_b: count of Class-B (moderate) features.
        class_c: count of Class-C (severe) features.
        area_fraction: fraction of cell area affected by power-relevant
            defects (0–1). Values outside the range are clamped; negative
            counts are floored to 0.

    Returns:
        A :class:`DefectIndexResult` with the index and its components.

    The index is the clamped sum of two components::

        count = COUNT_INDEX_MAX * min(1, weighted_score / SATURATION_SCORE)
        area  = AREA_INDEX_MAX  * clamp(area_fraction, 0, 1)

    where ``weighted_score = a·wA + b·wB + c·wC``.
    """
    a = max(0, class_a)
    b = max(0, class_b)
    c = max(0, class_c)
    area = _clamp(area_fraction, 0.0, 1.0)

    weighted_score = a * DEFECT_WEIGHT_A + b * DEFECT_WEIGHT_B + c * DEFECT_WEIGHT_C

    count_component = COUNT_INDEX_MAX * min(1.0, weighted_score / SATURATION_SCORE)
    area_component = AREA_INDEX_MAX * area

    index = _clamp(count_component + area_component, 0.0, 100.0)

    return DefectIndexResult(
        index=index,
        weighted_score=weighted_score,
        count_component=count_component,
        area_component=area_component,
    )


def classify_defect_index(index: float, mode: DefectMode = "default") -> str:
    """Map a defect index onto an A/B/C grade for the selected mode.

    Boundaries are inclusive on the lower grade (``index == a_max`` ⇒
    ``"A"``). ``mode`` selects the threshold set: ``"default"`` for the
    IEC TS 60904-13 review band or ``"mbj"`` for the stricter acceptance.
    """
    a_max, b_max = DEFECT_THRESHOLDS[mode]
    if index <= a_max:
        return "A"
    if index <= b_max:
        return "B"
    return "C"
