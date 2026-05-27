"""Tests for IEC 61215-2 MQT 18.1 BDT setup validation + DEMO/LIVE start."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.bdt_mqt18_setup import (  # noqa: E402
    LIVE_NOT_IMPLEMENTED_MSG,
    BdtMode,
    BdtSetup,
    default_test_current_a,
    is_valid,
    start_session,
    validate_setup,
)


def make_valid(**kw) -> BdtSetup:
    base = dict(
        isc_a=10.0,
        soak_temp_c=75.0,
        diode_count=2,
        diode_locations=["top-left", "top-right"],
        mode=BdtMode.DEMO,
    )
    base.update(kw)
    return BdtSetup(**base)


def test_default_test_current_is_1_25x_isc() -> None:
    assert default_test_current_a(10.0) == 12.5
    assert default_test_current_a(8.0) == 10.0
    # auto-applied when not supplied
    assert make_valid().test_current_a == 12.5


def test_baseline_is_valid() -> None:
    assert validate_setup(make_valid()) == []
    assert is_valid(make_valid()) is True


@pytest.mark.parametrize("isc,ok", [(0.5, False), (1.0, True), (20.0, True), (25.0, False)])
def test_isc_range(isc, ok) -> None:
    s = make_valid(isc_a=isc, test_current_a=default_test_current_a(isc))
    assert is_valid(s) is ok


def test_test_current_must_stay_at_or_above_1_25x_isc() -> None:
    assert is_valid(make_valid(isc_a=10.0, test_current_a=12.0)) is False  # below 12.5
    assert is_valid(make_valid(isc_a=10.0, test_current_a=12.5)) is True  # exactly
    assert is_valid(make_valid(isc_a=10.0, test_current_a=15.0)) is True  # editable up


@pytest.mark.parametrize("temp,ok", [(69.0, False), (70.0, True), (80.0, True), (81.0, False)])
def test_soak_temp_range(temp, ok) -> None:
    assert is_valid(make_valid(soak_temp_c=temp)) is ok


@pytest.mark.parametrize("count,ok", [(0, False), (1, True), (6, True), (7, False)])
def test_diode_count_range(count, ok) -> None:
    s = make_valid(diode_count=count, diode_locations=[f"d{i}" for i in range(count)])
    assert is_valid(s) is ok


def test_one_location_label_per_diode() -> None:
    assert is_valid(make_valid(diode_count=2, diode_locations=["a"])) is False
    assert is_valid(make_valid(diode_count=2, diode_locations=["a", "  "])) is False
    assert is_valid(make_valid(diode_count=2, diode_locations=["a", "b"])) is True


def test_live_start_raises_not_implemented() -> None:
    s = make_valid(mode=BdtMode.LIVE)
    with pytest.raises(NotImplementedError, match=re.escape(LIVE_NOT_IMPLEMENTED_MSG)):
        start_session(s, "sess-live", base_dir="/tmp")


def test_invalid_setup_raises_before_persisting(tmp_path) -> None:
    with pytest.raises(ValueError):
        start_session(make_valid(isc_a=99.0), "sess-bad", base_dir=tmp_path)
    assert not (tmp_path / "tests" / "bdt" / "sess-bad").exists()


def test_demo_start_persists_setup_json(tmp_path) -> None:
    s = make_valid(isc_a=8.0, test_current_a=10.0, diode_count=1, diode_locations=["center"])
    path = start_session(s, "sess-001", base_dir=tmp_path)
    assert path == tmp_path / "tests" / "bdt" / "sess-001" / "setup.json"
    assert path.is_file()
    data = json.loads(path.read_text())
    assert data["mode"] == "DEMO"
    assert data["isc_a"] == 8.0
    assert data["test_current_a"] == 10.0
    assert data["diode_locations"] == ["center"]
