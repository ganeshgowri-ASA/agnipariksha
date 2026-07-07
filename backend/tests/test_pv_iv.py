"""Tests for the DEMO PV module I-V model (solar-array-simulator emulation)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.pv_iv import (  # noqa: E402
    PvModule,
    iv_curve,
    max_power_point,
    pv_current,
)


def test_curve_endpoints():
    m = PvModule()
    assert pv_current(0.0, m) == m.isc          # short circuit → Isc
    assert pv_current(-5.0, m) == m.isc         # clamped below 0
    assert pv_current(m.voc, m) == 0.0          # open circuit → 0
    assert pv_current(m.voc + 10, m) == 0.0     # clamped above Voc


def test_passes_through_datasheet_mpp():
    m = PvModule()
    i_at_vmp = pv_current(m.vmp, m)
    assert i_at_vmp == pytest.approx(m.imp, rel=0.03)  # within 3 % of Imp


def test_current_is_monotonically_non_increasing():
    m = PvModule()
    prev = pv_current(0.0, m)
    for k in range(1, 101):
        v = m.voc * k / 100
        cur = pv_current(v, m)
        assert cur <= prev + 1e-9
        prev = cur


def test_mpp_near_datasheet_and_is_the_curve_maximum():
    m = PvModule()
    vmp, imp, pmp = max_power_point(m)
    assert vmp == pytest.approx(m.vmp, abs=3.0)   # V within a few volts
    assert imp == pytest.approx(m.imp, rel=0.05)
    # No sampled point on the curve beats the reported MPP.
    assert all(p <= pmp + 1e-6 for _, _, p in iv_curve(m, points=81))
    # Sanity: MPP power ≈ Vmp·Imp.
    assert pmp == pytest.approx(m.vmp * m.imp, rel=0.05)


def test_curve_shape_and_length():
    m = PvModule()
    curve = iv_curve(m, points=21)
    assert len(curve) == 21
    assert curve[0] == (0.0, m.isc, 0.0)
    assert curve[-1][0] == pytest.approx(m.voc)
    assert curve[-1][1] == 0.0


def test_invalid_module_rejected():
    with pytest.raises(ValueError):
        pv_current(10.0, PvModule(isc=5.0, imp=6.0))  # Imp > Isc
    with pytest.raises(ValueError):
        pv_current(10.0, PvModule(voc=30.0, vmp=35.0))  # Vmp > Voc
