"""Tests for the Ground Continuity Test (GCT) module + routes.

Covers the demo-mode simulator path, pass/fail logic, and the explicit
"PSU output must remain OFF" invariant in both REST and WebSocket
handlers.
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.gct import (  # noqa: E402
    DEFAULT_MAX_RESISTANCE_OHM,
    GctReading,
    GctSimulator,
    KeysightDmmGct,
    demo_per_path_resistances,
    evaluate_pass,
)
from backend.main import app  # noqa: E402


# ---------------------------------------------------------------------------
# Pure-logic unit tests
# ---------------------------------------------------------------------------

def test_evaluate_pass_below_threshold() -> None:
    assert evaluate_pass(0.05, 0.1) is True
    assert evaluate_pass(0.099, 0.1) is True


def test_evaluate_pass_at_or_above_threshold() -> None:
    # Strictly less-than, so the boundary fails (extra margin).
    assert evaluate_pass(0.1, 0.1) is False
    assert evaluate_pass(0.5, 0.1) is False


def test_evaluate_pass_invalid_threshold() -> None:
    assert evaluate_pass(0.0, 0.0) is False
    assert evaluate_pass(0.05, -1.0) is False


def test_gct_simulator_in_demo_range() -> None:
    sim = GctSimulator()
    samples = [sim.sample() for _ in range(200)]
    # Healthy bond: mean near 30 mΩ, all positive, almost all below the
    # 0.1 Ω limit. The distribution is Gaussian so the bound is loose.
    assert all(r >= 0.0 for r in samples)
    mean_r = sum(samples) / len(samples)
    assert 0.01 < mean_r < 0.06
    assert sum(1 for r in samples if r < DEFAULT_MAX_RESISTANCE_OHM) >= 195


@pytest.mark.asyncio
async def test_dmm_demo_measure_returns_pass() -> None:
    dmm = KeysightDmmGct(transport=None, demo=True)
    await dmm.configure_4wire()  # no-op in demo
    reading = await dmm.measure()
    assert isinstance(reading, GctReading)
    assert reading.demo is True
    assert reading.source == "sim"
    assert reading.max_resistance == DEFAULT_MAX_RESISTANCE_OHM
    assert reading.passed is True
    d = reading.to_dict()
    assert d["R"] == round(reading.resistance, 6)
    assert d["pass"] is True


@pytest.mark.asyncio
async def test_dmm_custom_threshold_marks_fail_when_too_strict() -> None:
    # 0.001 Ω is tighter than the simulator distribution -> almost always FAIL.
    dmm = KeysightDmmGct(demo=True, max_resistance=0.001)
    fails = 0
    for _ in range(30):
        r = await dmm.measure()
        if not r.passed:
            fails += 1
    assert fails > 20  # overwhelmingly FAIL at that threshold


def test_dmm_rejects_non_positive_threshold() -> None:
    dmm = KeysightDmmGct(demo=True)
    with pytest.raises(ValueError):
        dmm.set_max_resistance(0.0)
    with pytest.raises(ValueError):
        dmm.set_max_resistance(-0.1)


@pytest.mark.asyncio
async def test_dmm_live_path_sends_configure_and_read() -> None:
    """In non-demo mode we must hit the transport for CONF + READ?, not the simulator."""

    class _FakeTransport:
        def __init__(self) -> None:
            self.sent: list[str] = []

        async def send(self, cmd: str) -> None:
            self.sent.append(cmd)

        async def query(self, cmd: str) -> str:
            self.sent.append(cmd)
            return "0.0427"

    t = _FakeTransport()
    dmm = KeysightDmmGct(transport=t, demo=False, max_resistance=0.1)
    reading = await dmm.measure()
    # CONF:FRES, FRES:NPLC, TRIG:SOUR, READ?
    assert any(s.startswith("CONF:FRES") for s in t.sent)
    assert any(s.startswith("FRES:NPLC") for s in t.sent)
    assert "READ?" in t.sent
    assert reading.source == "dmm_keysight"
    assert reading.demo is False
    assert abs(reading.resistance - 0.0427) < 1e-6
    assert reading.passed is True


# ---------------------------------------------------------------------------
# REST endpoint tests
# ---------------------------------------------------------------------------

client = TestClient(app)


def test_gct_config_endpoint() -> None:
    r = client.get("/api/gct/config")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["max_resistance"] == DEFAULT_MAX_RESISTANCE_OHM
    assert body["dmm_device_id"] == "dmm_keysight"
    assert body["standard"] == "IEC 61730-2 MST 13"


def test_gct_measure_demo_returns_pass() -> None:
    r = client.post("/api/gct/measure", json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["demo"] is True
    assert body["source"] == "sim"
    assert body["max_resistance"] == DEFAULT_MAX_RESISTANCE_OHM
    assert body["resistance"] >= 0.0
    assert isinstance(body["passed"], bool)
    # PSU off flag is True in demo (the demo client accepts OUTP OFF).
    assert body["psu_output_off"] is True


def test_gct_measure_custom_threshold_serializes() -> None:
    r = client.post("/api/gct/measure", json={"max_resistance": 0.05})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["max_resistance"] == 0.05


def test_gct_measure_psu_output_forced_off() -> None:
    """The measure handler must call ``OUTP OFF`` on the PSU. Spy on
    ScpiClient.send to make sure that happens."""
    sent: list[str] = []

    original_send = None

    async def _spy_send(self, command: str) -> None:  # noqa: ANN001
        sent.append(command)
        if original_send is not None:
            await original_send(self, command)

    from backend import scpi_async as scpi_async_mod

    original_send = scpi_async_mod.ScpiClient.send
    with patch.object(scpi_async_mod.ScpiClient, "send", _spy_send):
        r = client.post("/api/gct/measure", json={})
        assert r.status_code == 200, r.text
    assert any(cmd == "OUTP OFF" for cmd in sent), f"OUTP OFF not sent (got: {sent})"
    # And critically, no OUTP ON anywhere in the GCT path.
    assert not any("OUTP ON" in cmd.upper() for cmd in sent)


def test_gct_measure_rejects_invalid_threshold() -> None:
    r = client.post("/api/gct/measure", json={"max_resistance": -1.0})
    assert r.status_code == 422
    r = client.post("/api/gct/measure", json={"max_resistance": 0.0})
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# WebSocket smoke test — demo path only (live needs hardware).
# ---------------------------------------------------------------------------

def test_ws_gct_live_streams_readings() -> None:
    with client.websocket_connect("/ws/gct/live?interval=0.1") as ws:
        # First frame is the gct_status preamble.
        status = ws.receive_json()
        assert status["type"] == "gct_status"
        assert status["psu_output_off"] is True
        assert status["max_resistance"] == DEFAULT_MAX_RESISTANCE_OHM

        # Then at least one resistance reading.
        msg = ws.receive_json()
        assert msg["type"] == "gct_reading"
        assert msg["source"] == "sim"
        assert msg["demo"] is True
        assert "resistance" in msg
        assert "pass" in msg
        ws.send_json({"type": "stop"})


def test_ws_gct_live_honours_max_resistance_query() -> None:
    with client.websocket_connect(
        "/ws/gct/live?interval=0.1&max_resistance=0.5"
    ) as ws:
        status = ws.receive_json()
        assert status["type"] == "gct_status"
        assert status["max_resistance"] == 0.5
        reading = ws.receive_json()
        assert reading["max_resistance"] == 0.5
        ws.send_json({"type": "stop"})


def test_ws_gct_live_rejects_bad_max_resistance() -> None:
    with client.websocket_connect("/ws/gct/live?max_resistance=-1") as ws:
        err = ws.receive_json()
        assert err["type"] == "error"
        assert err["error"] == "bad_max_resistance"


# ---------------------------------------------------------------------------
# Per-path resistance breakdown (Analysis view, DEMO mode)
# ---------------------------------------------------------------------------

def test_demo_per_path_resistances_shape_and_pass() -> None:
    paths = demo_per_path_resistances()
    assert [p["path_id"] for p in paths] == [
        "PATH-01", "PATH-02", "PATH-03", "PATH-04", "PATH-05", "PATH-06"
    ]
    assert all(p["passed"] for p in paths)                # all < 0.1 Ω
    assert max(p["resistance"] for p in paths) == 0.094   # worst is PATH-06
    assert paths[0]["from_point"] == "Frame-A"
    assert paths[0]["to_point"] == "JBox"


def test_demo_per_path_resistances_regrade_on_tighter_threshold() -> None:
    # A 0.05 Ω ceiling fails the four paths above it (0.067/0.051/0.089/0.094).
    paths = demo_per_path_resistances(max_resistance=0.05)
    assert sum(1 for p in paths if not p["passed"]) == 4


def test_gct_config_emits_per_path_resistances_in_demo() -> None:
    body = client.get("/api/gct/config").json()
    paths = body["per_path_resistances"]
    assert len(paths) == 6
    assert paths[0]["path_id"] == "PATH-01"
    assert all(p["passed"] for p in paths)
