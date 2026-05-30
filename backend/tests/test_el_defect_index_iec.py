"""IEC TS 60904-13 + IEA PVPS Task 13 contract tests for the EL defect index.

Pins the index math, every A/B/C classification boundary, and the
DEFAULT-vs-MBJ threshold differences. The frontend mirrors the same math in
``frontend/features/el/analysis/defectIndex.ts``; the two MUST agree.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Make ``backend`` importable in CI where pytest runs from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_programs.el_defect import (  # noqa: E402
    COUNT_INDEX_MAX,
    DEFECT_THRESHOLDS,
    DEFECT_WEIGHT_A,
    DEFECT_WEIGHT_B,
    DEFECT_WEIGHT_C,
    classify_defect_index,
    compute_defect_index,
)


class TestComputeDefectIndex:
    """DEFECT INDEX math (IEC TS 60904-13 + IEA PVPS Task 13)."""

    def test_pristine_scores_zero(self) -> None:
        assert compute_defect_index(0, 0, 0, 0.0).index == 0.0

    def test_weighted_score_is_a1_b5_c15(self) -> None:
        r = compute_defect_index(2, 1, 1, 0.0)
        # 2*1 + 1*5 + 1*15 = 22
        assert r.weighted_score == 22.0
        assert (DEFECT_WEIGHT_A, DEFECT_WEIGHT_B, DEFECT_WEIGHT_C) == (1.0, 5.0, 15.0)

    def test_area_term_is_linear(self) -> None:
        assert compute_defect_index(0, 0, 0, 0.5).index == pytest.approx(20.0)
        assert compute_defect_index(0, 0, 0, 1.0).index == pytest.approx(40.0)
        assert compute_defect_index(0, 0, 0, 0.25).area_component == pytest.approx(10.0)

    def test_count_component_saturates(self) -> None:
        # 2×Class-C = weighted 30 = SATURATION_SCORE → count axis caps at 60.
        r = compute_defect_index(0, 0, 2, 0.0)
        assert r.count_component == pytest.approx(COUNT_INDEX_MAX)
        assert r.index == pytest.approx(60.0)

    def test_count_component_partial_below_saturation(self) -> None:
        # 1×Class-C = 15 → 60 * 15/30 = 30
        assert compute_defect_index(0, 0, 1, 0.0).index == pytest.approx(30.0)
        # 1×Class-B = 5 → 60 * 5/30 = 10
        assert compute_defect_index(0, 1, 0, 0.0).index == pytest.approx(10.0)

    def test_index_clamped_to_100(self) -> None:
        assert compute_defect_index(0, 0, 10, 1.0).index == 100.0

    def test_negative_and_out_of_range_sanitised(self) -> None:
        r = compute_defect_index(-5, -1, 0, 2.0)
        assert r.weighted_score == 0.0
        assert r.index == pytest.approx(40.0)  # area clamped to 1 → 40


class TestClassifyDefault:
    """DEFAULT thresholds — IEC TS 60904-13 review band (20 / 50)."""

    def test_grade_a_at_and_below_a_max(self) -> None:
        a_max, _ = DEFECT_THRESHOLDS["default"]
        assert classify_defect_index(0.0, "default") == "A"
        assert classify_defect_index(a_max, "default") == "A"  # 20 inclusive

    def test_grade_b_between_cut_points(self) -> None:
        a_max, b_max = DEFECT_THRESHOLDS["default"]
        assert classify_defect_index(a_max + 0.01, "default") == "B"
        assert classify_defect_index(b_max, "default") == "B"  # 50 inclusive

    def test_grade_c_above_b_max(self) -> None:
        _, b_max = DEFECT_THRESHOLDS["default"]
        assert classify_defect_index(b_max + 0.01, "default") == "C"
        assert classify_defect_index(100.0, "default") == "C"

    def test_default_mode_is_the_default_arg(self) -> None:
        assert classify_defect_index(15.0) == "A"
        assert classify_defect_index(40.0) == "B"


class TestClassifyMbj:
    """MBJ thresholds — stricter acceptance (10 / 30)."""

    def test_grade_a_at_and_below_a_max(self) -> None:
        a_max, _ = DEFECT_THRESHOLDS["mbj"]
        assert classify_defect_index(a_max, "mbj") == "A"  # 10 inclusive

    def test_grade_b_between_cut_points(self) -> None:
        a_max, b_max = DEFECT_THRESHOLDS["mbj"]
        assert classify_defect_index(a_max + 0.01, "mbj") == "B"
        assert classify_defect_index(b_max, "mbj") == "B"  # 30 inclusive

    def test_grade_c_above_b_max(self) -> None:
        _, b_max = DEFECT_THRESHOLDS["mbj"]
        assert classify_defect_index(b_max + 0.01, "mbj") == "C"


class TestDefaultVsMbj:
    """The MBJ set MUST grade stricter than DEFAULT at the same index."""

    def test_same_index_grades_lower_under_mbj(self) -> None:
        # index 20: DEFAULT A (<=20), MBJ B (>10)
        assert classify_defect_index(20.0, "default") == "A"
        assert classify_defect_index(20.0, "mbj") == "B"
        # index 40: DEFAULT B (<=50), MBJ C (>30)
        assert classify_defect_index(40.0, "default") == "B"
        assert classify_defect_index(40.0, "mbj") == "C"

    def test_real_module_one_class_c_plus_area(self) -> None:
        # 1×Class-C + area 0.5 → count 30 + area 20 = 50
        idx = compute_defect_index(0, 0, 1, 0.5).index
        assert idx == pytest.approx(50.0)
        assert classify_defect_index(idx, "default") == "B"  # 50 == b_max
        assert classify_defect_index(idx, "mbj") == "C"      # 50 > 30

    def test_mbj_cut_points_are_lower(self) -> None:
        assert DEFECT_THRESHOLDS["mbj"][0] < DEFECT_THRESHOLDS["default"][0]
        assert DEFECT_THRESHOLDS["mbj"][1] < DEFECT_THRESHOLDS["default"][1]
