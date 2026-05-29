"""IEC 61215-2 MQT 12 contract tests for the HF orchestrator helpers."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_programs.humidity_freeze import (  # noqa: E402
    MQT12_COLD_DWELL_MIN_S,
    MQT12_HOT_DWELL_MIN_S,
    MQT12_ISC_GATE_C,
    MQT12_RH_TARGET_PCT,
    MQT12_RH_TOL_PCT,
    mqt12_isc_gate_setpoint,
    validate_hf_setup,
)


class TestHfIscGate:
    """MQT 11.6.3 a applies to HF as well \u2014 same threshold."""

    def test_gate_closed_below_threshold(self) -> None:
        assert mqt12_isc_gate_setpoint(20, 9.5) == 0.0
        assert mqt12_isc_gate_setpoint(MQT12_ISC_GATE_C, 9.5) == 0.0

    def test_gate_open_above_threshold(self) -> None:
        assert mqt12_isc_gate_setpoint(MQT12_ISC_GATE_C + 0.01, 9.5) == 9.5
        assert mqt12_isc_gate_setpoint(85, 9.5) == 9.5


class TestValidateHfSetup:
    """MQT 12.6.2 setup pre-flight checks."""

    def test_canonical_setup_passes(self) -> None:
        issues = validate_hf_setup(
            cycles=10,
            hot_dwell_s=MQT12_HOT_DWELL_MIN_S,
            cold_dwell_s=MQT12_COLD_DWELL_MIN_S,
            rh_setpoint_pct=MQT12_RH_TARGET_PCT,
        )
        assert issues == []

    def test_low_cycle_count_flags(self) -> None:
        issues = validate_hf_setup(5, MQT12_HOT_DWELL_MIN_S, MQT12_COLD_DWELL_MIN_S, MQT12_RH_TARGET_PCT)
        assert any("MQT 12 specifies 10 cycles" in i for i in issues)

    def test_short_hot_dwell_flags(self) -> None:
        issues = validate_hf_setup(10, 10 * 3600, MQT12_COLD_DWELL_MIN_S, MQT12_RH_TARGET_PCT)
        assert any("Hot/humid dwell" in i for i in issues)

    def test_short_cold_dwell_flags(self) -> None:
        issues = validate_hf_setup(10, MQT12_HOT_DWELL_MIN_S, 10 * 60, MQT12_RH_TARGET_PCT)
        assert any("Cold freeze dwell" in i for i in issues)

    def test_rh_out_of_band_flags(self) -> None:
        issues = validate_hf_setup(10, MQT12_HOT_DWELL_MIN_S, MQT12_COLD_DWELL_MIN_S, 60.0)
        assert any("RH setpoint" in i for i in issues)

    def test_rh_within_tolerance_passes(self) -> None:
        issues = validate_hf_setup(
            10, MQT12_HOT_DWELL_MIN_S, MQT12_COLD_DWELL_MIN_S,
            MQT12_RH_TARGET_PCT + MQT12_RH_TOL_PCT,
        )
        assert all("RH setpoint" not in i for i in issues)

    @pytest.mark.parametrize("rh", [80.0, 84.9, 85.0, 85.1, 90.0])
    def test_rh_boundary_band(self, rh: float) -> None:
        issues = validate_hf_setup(10, MQT12_HOT_DWELL_MIN_S, MQT12_COLD_DWELL_MIN_S, rh)
        rh_issue = any("RH setpoint" in i for i in issues)
        within = abs(rh - MQT12_RH_TARGET_PCT) <= MQT12_RH_TOL_PCT
        assert (not rh_issue) == within
