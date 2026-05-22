"""Verify IEC 61215-2 Ed 2.0 (2021-02) constants are encoded exactly.

These values are taken verbatim from the published standard and must
never drift silently. Every test below uses ``pytest.approx`` with an
absolute tolerance of 1e-9 only because the constants are floats — the
*intent* is exact equality.
"""
from __future__ import annotations

import importlib

import pytest

from backend.standards import iec_61215_2_constants as C


# Each entry: (attribute name, expected value)
_FLOAT_CASES = [
    # TC — MQT 11
    ("TC_T_LOW_C", -40.0),
    ("TC_T_HIGH_C", 85.0),
    ("TC_MAX_RAMP_C_PER_HOUR", 100.0),
    ("TC_MIN_DWELL_MIN", 10.0),
    ("TC_MAX_CYCLE_HOURS", 6.0),
    ("TC_CURRENT_HEATUP_FRAC_ISC", 1.0),
    ("TC_CURRENT_COOLDOWN_FRAC_ISC_MAX", 0.01),
    # HF — MQT 12
    ("HF_T_LOW_C", -40.0),
    ("HF_T_HIGH_C", 85.0),
    ("HF_RH_HIGH_PCT", 85.0),
    ("HF_CURRENT_FRAC_ISC_MAX", 0.005),
    ("HF_CURRENT_FLOOR_MA", 100.0),
    # DH — MQT 13
    ("DH_TEMP_C", 85.0),
    ("DH_RH_PCT", 85.0),
    ("DH_DURATION_H", 1000.0),
    # BPDT — MQT 18
    ("BPDT_TEST_TEMP_C", 75.0),
    ("BPDT_TEST_DURATION_H", 1.0),
    ("BPDT_CURRENT_MULTIPLIER", 1.25),
    ("BPDT_PULSE_WIDTH_MS_MAX", 1.0),
    # PID — IEC TS 62804-1
    ("PID_TEMP_C", 85.0),
    ("PID_RH_PCT", 85.0),
    ("PID_DURATION_H", 96.0),
    # GCT — IEC 61730-2 §5.3.2
    ("GCT_TEST_CURRENT_A", 25.0),
    ("GCT_MAX_RESISTANCE_OHM", 0.1),
    # RCOT — IEC 61730-2 MST 26
    ("RCOT_OCPD_MULTIPLIER", 1.35),
    ("RCOT_DURATION_H", 2.0),
]

_INT_CASES = [
    ("HF_CYCLES", 10),
    ("PID_SAMPLE_COUNT_PER_POLARITY", 2),
]


@pytest.mark.parametrize("name,expected", _FLOAT_CASES)
def test_float_constant_matches_iec_61215_2_ed2(name: str, expected: float) -> None:
    actual = getattr(C, name)
    assert isinstance(actual, float), f"{name} must be a float, got {type(actual).__name__}"
    assert actual == pytest.approx(expected, abs=1e-9)


@pytest.mark.parametrize("name,expected", _INT_CASES)
def test_int_constant_matches_iec_61215_2_ed2(name: str, expected: int) -> None:
    actual = getattr(C, name)
    assert isinstance(actual, int) and not isinstance(actual, bool)
    assert actual == expected


def test_bpdt_tj_characterization_sequence_is_order_sensitive() -> None:
    assert C.BPDT_TJ_CHARACTERIZATION_C == [30.0, 50.0, 70.0, 90.0]


def test_standard_edition_mentions_2021_02() -> None:
    assert "2021-02" in C.STANDARD_EDITION
    assert "IEC 61215-2" in C.STANDARD_EDITION
    assert "Edition 2.0" in C.STANDARD_EDITION


def test_module_importable_via_package_path() -> None:
    mod = importlib.import_module("backend.standards.iec_61215_2_constants")
    assert mod.STANDARD_EDITION == C.STANDARD_EDITION


def test_module_importable_via_script_mode_fallback() -> None:
    """Script-mode invocations (cwd == backend/) should also work."""
    import sys
    from pathlib import Path

    backend_dir = Path(C.__file__).resolve().parents[1]
    added = False
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))
        added = True
    try:
        sys.modules.pop("standards", None)
        sys.modules.pop("standards.iec_61215_2_constants", None)
        mod = importlib.import_module("standards.iec_61215_2_constants")
        assert mod.STANDARD_EDITION == C.STANDARD_EDITION
        assert mod.BPDT_TJ_CHARACTERIZATION_C == [30.0, 50.0, 70.0, 90.0]
    finally:
        if added:
            sys.path.remove(str(backend_dir))
