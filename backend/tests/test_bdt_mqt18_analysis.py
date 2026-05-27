"""Tests for IEC 61215-2 MQT 18.1 BDT analysis: regression, verdict, plot."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.bdt_mqt18_analysis import (  # noqa: E402
    DEFAULT_TJ_MAX_C,
    FAIL,
    PASS,
    analyse_diode,
    data_table_row,
    diode_verdict,
    regress_vd_vs_tj,
    synthesize_demo_diode,
    plot_diode,
)


def test_regression_recovers_known_line() -> None:
    tj = np.linspace(30.0, 90.0, 25)
    vd = 0.85 + (-0.002) * tj  # -2.0 mV/C, intercept 0.85 V, noiseless
    slope, intercept, r2 = regress_vd_vs_tj(tj, vd)
    assert slope == pytest.approx(-2.0, abs=1e-6)
    assert intercept == pytest.approx(0.85, abs=1e-6)
    assert r2 == pytest.approx(1.0, abs=1e-9)


def test_regression_matches_numpy_polyfit() -> None:
    tj = [30.0, 45.0, 60.0, 75.0, 90.0]
    vd = [0.80, 0.77, 0.75, 0.72, 0.70]
    slope, intercept, _ = regress_vd_vs_tj(tj, vd)
    ref_slope, ref_int = np.polyfit(tj, vd, 1)
    assert slope == pytest.approx(ref_slope * 1000.0)
    assert intercept == pytest.approx(ref_int)


def test_regression_requires_two_spanning_points() -> None:
    with pytest.raises(ValueError):
        regress_vd_vs_tj([50.0], [0.7])
    with pytest.raises(ValueError):
        regress_vd_vs_tj([50.0, 50.0, 50.0], [0.7, 0.71, 0.69])


def test_verdict_pass_below_tjmax() -> None:
    assert diode_verdict(150.0) == PASS  # default 200 C ceiling
    assert diode_verdict(200.0) == PASS  # boundary inclusive


def test_verdict_fail_over_tjmax_or_not_conducting() -> None:
    assert diode_verdict(205.0) == FAIL
    assert diode_verdict(150.0, conducts=False) == FAIL


def test_verdict_tjmax_is_configurable() -> None:
    assert diode_verdict(150.0, tj_max_c=120.0) == FAIL
    assert diode_verdict(110.0, tj_max_c=120.0) == PASS


def test_analyse_diode_rolls_up_regression_and_verdict() -> None:
    tj, vd = synthesize_demo_diode(seed=7)
    reg = analyse_diode("D1", tj, vd)
    assert reg.diode_id == "D1"
    assert reg.tj_max_observed_c == pytest.approx(90.0)
    assert reg.verdict == PASS  # 90 C << default 200 C
    assert reg.slope_mV_per_C == pytest.approx(-2.0, abs=0.6)
    assert DEFAULT_TJ_MAX_C == 200.0


def test_demo_synthesis_is_seeded_and_near_target_slope() -> None:
    tj1, vd1 = synthesize_demo_diode(seed=42)
    tj2, vd2 = synthesize_demo_diode(seed=42)
    assert np.array_equal(vd1, vd2)  # reproducible
    assert not np.array_equal(vd1, synthesize_demo_diode(seed=43)[1])
    slope, _, r2 = regress_vd_vs_tj(tj1, vd1)
    assert slope == pytest.approx(-2.0, abs=0.5)
    assert r2 > 0.9


def test_data_table_row_schema() -> None:
    reg = analyse_diode("D2", *synthesize_demo_diode(seed=1))
    row = data_table_row(reg)
    assert set(row) == {"diode_id", "slope_mV_per_C", "R_squared", "Tj_max_observed_C", "verdict"}
    assert row["diode_id"] == "D2"
    assert row["verdict"] in (PASS, FAIL)


def test_plot_diode_writes_png(tmp_path) -> None:
    tj, vd = synthesize_demo_diode(seed=3)
    reg = analyse_diode("D3", tj, vd)
    path = plot_diode("D3", tj, vd, reg, "sess-xyz", base_dir=tmp_path)
    assert path == tmp_path / "tests" / "bdt" / "sess-xyz" / "plots" / "diode_D3.png"
    assert path.is_file() and path.stat().st_size > 0
    assert path.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"  # PNG magic
