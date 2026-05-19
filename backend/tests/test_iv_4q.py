"""Tests for the 4-Quadrant IV acquisition mode (G14).

Covers the single-diode synthetic curve, the derived-metrics math, the
B2901aSmu live SCPI path (mocked transport), and the REST routes
including the "PSU output must remain OFF" invariant.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.iv.four_quadrant import (  # noqa: E402
    B2901aSmu,
    IvSweepConfig,
    compute_metrics,
    single_diode_curve,
)
from backend.main import app  # noqa: E402


# ---------------------------------------------------------------------------
# Pytest fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def demo_sweep_cfg() -> IvSweepConfig:
    return IvSweepConfig(
        vmin=-2.0, vmax=45.0, steps=51, dwell_ms=10.0,
        compliance_i=10.0, nplc=1.0, four_wire=True,
    )


@pytest.fixture()
def demo_curve(demo_sweep_cfg: IvSweepConfig) -> tuple[list[float], list[float]]:
    return single_diode_curve(demo_sweep_cfg.vmin, demo_sweep_cfg.vmax, demo_sweep_cfg.steps)


# ---------------------------------------------------------------------------
# Unit tests — synthetic curve + metrics
# ---------------------------------------------------------------------------

def test_single_diode_curve_spans_all_four_quadrants() -> None:
    v, i = single_diode_curve(-5.0, 45.0, 101, noise=0.0)
    assert len(v) == 101
    assert len(i) == 101
    assert v[0] < 0 < v[-1]
    # Q1 reachable (V>0, I>0)
    assert any(vv > 0 and ii > 0 for vv, ii in zip(v, i))
    # Q2 reachable (V<0, I>0) for typical SDM
    assert any(vv < 0 and ii > 0 for vv, ii in zip(v, i))


def test_metrics_recover_voc_isc_pmax(demo_curve: tuple[list[float], list[float]]) -> None:
    v, i = demo_curve
    m = compute_metrics(v, i)
    # Synthetic 330 W class module: rough sanity bounds (with noise)
    assert 8.0 < m["isc"] < 11.0
    assert 38.0 < m["voc"] < 43.0
    assert 250.0 < m["pmax"] < 360.0
    assert 0 < m["vmpp"] < m["voc"]
    assert 0 < m["impp"] < m["isc"]
    assert 0.5 < m["ff"] <= 1.0
    assert 0.0 < m["eta"] < 1.0


def test_metrics_empty_inputs_return_zeros() -> None:
    m = compute_metrics([], [])
    assert all(v == 0.0 for v in m.values())


def test_sweep_config_validates() -> None:
    with pytest.raises(ValueError):
        IvSweepConfig(vmin=10.0, vmax=5.0).validate()
    with pytest.raises(ValueError):
        IvSweepConfig(vmin=0, vmax=1, steps=1).validate()
    with pytest.raises(ValueError):
        IvSweepConfig(vmin=0, vmax=1, compliance_i=0).validate()
    with pytest.raises(ValueError):
        IvSweepConfig(vmin=0, vmax=1, nplc=0).validate()
    IvSweepConfig(vmin=-2.0, vmax=45.0).validate()  # ok


# ---------------------------------------------------------------------------
# Driver tests — demo + live SCPI mock
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_smu_demo_acquire_returns_curve(demo_sweep_cfg: IvSweepConfig) -> None:
    smu = B2901aSmu(transport=None, demo=True)
    curve = await smu.acquire(demo_sweep_cfg, "iv4q-test")
    assert curve.demo is True
    assert curve.source == "sim"
    assert len(curve.v) == demo_sweep_cfg.steps
    assert curve.pmax > 0
    assert curve.run_id == "iv4q-test"


@pytest.mark.asyncio
async def test_smu_live_path_sends_configure_sweep_and_outp_off(
    demo_sweep_cfg: IvSweepConfig,
) -> None:
    """The live path must (a) program the sweep, (b) FETC the arrays,
    (c) always issue ``:OUTP OFF`` even if FETC succeeds."""

    class _FakeTransport:
        def __init__(self) -> None:
            self.sent: list[str] = []

        async def send(self, cmd: str) -> None:
            self.sent.append(cmd)

        async def query(self, cmd: str) -> str:
            self.sent.append(cmd)
            if "VOLT" in cmd:
                return "-1.0, 0.0, 20.0, 40.0"
            return "9.4, 9.4, 9.0, 0.1"

    t = _FakeTransport()
    smu = B2901aSmu(transport=t, demo=False)
    curve = await smu.acquire(demo_sweep_cfg, "iv4q-live")
    assert curve.demo is False
    assert curve.source == "b2901a"
    assert len(curve.v) == 4
    assert any(s.startswith(":SOUR:VOLT:STAR") for s in t.sent)
    assert any(s.startswith(":SOUR:VOLT:STOP") for s in t.sent)
    assert any(s.startswith(":SOUR:VOLT:POIN") for s in t.sent)
    assert ":OUTP ON" in t.sent
    assert ":OUTP OFF" in t.sent
    # OUTP OFF must come *after* OUTP ON
    assert t.sent.index(":OUTP OFF") > t.sent.index(":OUTP ON")


# ---------------------------------------------------------------------------
# REST endpoint tests
# ---------------------------------------------------------------------------

client = TestClient(app)


def test_iv_4q_start_demo_returns_run_id() -> None:
    r = client.post("/api/iv/4q/start", json={
        "vmin": -2.0, "vmax": 45.0, "steps": 51,
        "dwell_ms": 10.0, "compliance_i": 10.0, "nplc": 1.0, "four_wire": True,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accepted"] is True
    assert body["demo"] is True
    assert body["source"] == "sim"
    assert body["psu_output_off"] is True
    assert body["run_id"].startswith("iv4q-")


def test_iv_4q_curve_returns_arrays_and_metrics() -> None:
    started = client.post("/api/iv/4q/start", json={
        "vmin": -2.0, "vmax": 45.0, "steps": 101,
    }).json()
    run_id = started["run_id"]
    r = client.get(f"/api/iv/4q/curve/{run_id}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["run_id"] == run_id
    assert len(body["v"]) == 101
    assert len(body["i"]) == 101
    for key in ("pmax", "voc", "isc", "vmpp", "impp", "ff", "eta"):
        assert key in body
    assert body["pmax"] > 0


def test_iv_4q_curve_404_on_unknown_run() -> None:
    r = client.get("/api/iv/4q/curve/iv4q-doesnotexist")
    assert r.status_code == 404


def test_iv_4q_start_rejects_inverted_range() -> None:
    r = client.post("/api/iv/4q/start", json={
        "vmin": 10.0, "vmax": 5.0, "steps": 51,
    })
    assert r.status_code == 422


def test_iv_4q_start_forces_psu_output_off() -> None:
    """REST handler must call ``OUTP OFF`` on the PSU — SMU-only flow."""
    sent: list[str] = []

    async def _spy_send(self, command: str) -> None:  # noqa: ANN001
        sent.append(command)

    from backend import scpi_async as scpi_async_mod

    with patch.object(scpi_async_mod.ScpiClient, "send", _spy_send):
        r = client.post("/api/iv/4q/start", json={"vmin": -1.0, "vmax": 42.0, "steps": 11})
        assert r.status_code == 200, r.text
    assert any(cmd == "OUTP OFF" for cmd in sent), f"OUTP OFF not sent (got: {sent})"
    assert not any("OUTP ON" in cmd.upper() for cmd in sent)


def test_template_config_present_and_valid() -> None:
    """Doc template must exist and parse — it's referenced by ops."""
    path = ROOT / "docs" / "templates" / "iv-4quadrant.config.json"
    assert path.exists(), "docs/templates/iv-4quadrant.config.json missing"
    data = json.loads(path.read_text())
    assert "request" in data
    req = data["request"]
    for key in ("vmin", "vmax", "steps", "dwell_ms", "compliance_i", "nplc", "four_wire"):
        assert key in req, f"template missing {key}"
