"""Tests for the PSU+Scope IV acquisition mode.

Covers
------
* POST /api/iv/psu-scope/start returns a run_id + demo flag.
* Demo-mode WebSocket emits a synthetic single-diode sweep ending with
  a ``{"done": True}`` frame and never opens an SCPI socket.
* Validation rejects out-of-range config.
* The gated PSU helpers all route through ``_enforce_basic_check`` and
  none of them issue ``OUTP ON``.
* Streaming an unknown run_id returns an error envelope and closes.
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.iv import psu_scope as ps  # noqa: E402
from backend.main import app  # noqa: E402


client = TestClient(app)


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

def test_synthetic_iv_endpoints() -> None:
    # At V=0 we should be near Isc, at V=Voc we should be ~0.
    isc, voc = 9.5, 50.0
    assert abs(ps._synthetic_iv(0.0, isc=isc, voc=voc) - isc) < 1e-6
    assert ps._synthetic_iv(voc, isc=isc, voc=voc) == 0.0


def test_step_v_advances() -> None:
    assert ps._step_v(0.0, 10.0, 0.1) == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# HTTP /start
# ---------------------------------------------------------------------------

def test_start_returns_run_id_and_demo_flag() -> None:
    body = {
        "psu_ramp_rate_v_s": 5.0,
        "shunt_ohms": 0.001,
        "scope_channel": 1,
        "scope_timebase_ms": 10.0,
        "scope_trigger_v": 0.0,
        "sample_rate_hz": 1000.0,
        "sweeps": 1,
        "v_max": 10.0,
    }
    r = client.post("/api/iv/psu-scope/start", json=body)
    assert r.status_code == 200
    payload = r.json()
    assert "run_id" in payload and len(payload["run_id"]) > 0
    assert payload["demo"] is True  # DEMO_MODE default in settings


def test_start_rejects_bad_config() -> None:
    bad = {
        "psu_ramp_rate_v_s": -1.0,
        "shunt_ohms": 0.001,
        "scope_channel": 1,
        "scope_timebase_ms": 10.0,
        "scope_trigger_v": 0.0,
        "sample_rate_hz": 1000.0,
        "sweeps": 1,
        "v_max": 10.0,
    }
    assert client.post("/api/iv/psu-scope/start", json=bad).status_code == 422


# ---------------------------------------------------------------------------
# WebSocket demo path
# ---------------------------------------------------------------------------

def _start_demo_run(v_max: float = 2.0, rate_hz: float = 2000.0, ramp: float = 100.0) -> str:
    r = client.post("/api/iv/psu-scope/start", json={
        "psu_ramp_rate_v_s": ramp,
        "shunt_ohms": 0.001,
        "scope_channel": 1,
        "scope_timebase_ms": 10.0,
        "scope_trigger_v": 0.0,
        "sample_rate_hz": rate_hz,
        "sweeps": 1,
        "v_max": v_max,
    })
    assert r.status_code == 200
    return r.json()["run_id"]


def test_ws_demo_streams_sweep_then_done() -> None:
    run_id = _start_demo_run()
    seen_pairs = 0
    done = False
    with client.websocket_connect(f"/api/iv/psu-scope/stream/{run_id}") as ws:
        # Iterate a bounded number of frames; the synthetic sweep ends with
        # a "done" envelope. Cap at 200 so a runaway test still terminates.
        for _ in range(200):
            msg = ws.receive_json()
            if msg.get("done"):
                done = True
                assert msg["sweeps"] == 1
                break
            assert {"sweep", "t", "v", "i"} <= msg.keys()
            assert msg["v"] >= 0.0
            assert msg["i"] >= 0.0
            seen_pairs += 1
    assert done and seen_pairs >= 2


def test_ws_unknown_run_id_returns_error() -> None:
    with client.websocket_connect("/api/iv/psu-scope/stream/does-not-exist") as ws:
        msg = ws.receive_json()
        assert msg.get("error") == "unknown_run_id"


# ---------------------------------------------------------------------------
# Safety invariants on the gated PSU helpers
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_psu_helpers_route_through_basic_check() -> None:
    sent: list[str] = []
    gated: list[str] = []

    class _Fake:
        async def send(self, cmd: str) -> None:
            sent.append(cmd)

    async def _gate(cmd: str) -> None:
        gated.append(cmd)

    with patch.object(ps, "_enforce_basic_check", _gate):
        await ps._psu_set_voltage(_Fake(), 12.5)
        await ps._psu_set_current(_Fake(), 4.2)
        await ps._psu_output(_Fake(), False)

    # Every PSU command must have been gated first; the gated command must
    # match the SCPI command we actually sent.
    assert len(gated) == 3 and len(sent) == 3
    for cmd in sent:
        assert cmd in gated
    # PSU OUTPUT stays OFF in this test surface.
    assert not any("OUTP" in c and "ON" in c.upper().split() for c in sent)


@pytest.mark.asyncio
async def test_psu_output_off_command_shape() -> None:
    sent: list[str] = []

    class _Fake:
        async def send(self, cmd: str) -> None:
            sent.append(cmd)

    async def _gate(_cmd: str) -> None:
        return None

    with patch.object(ps, "_enforce_basic_check", _gate):
        await ps._psu_output(_Fake(), False)

    assert sent == ["OUTPut OFF"]


def test_demo_stream_never_touches_scpi() -> None:
    """Demo mode must not instantiate or connect a ScpiClient."""
    run_id = _start_demo_run()
    with patch.object(ps, "ScpiClient", autospec=True) as mock_cls:
        instance = mock_cls.return_value
        instance.connect = AsyncMock(return_value=False)
        instance.send = AsyncMock()
        instance.query = AsyncMock(return_value="0")
        instance.close = AsyncMock()
        with client.websocket_connect(f"/api/iv/psu-scope/stream/{run_id}") as ws:
            # Drain until done so the server-side handler completes.
            for _ in range(200):
                m = ws.receive_json()
                if m.get("done"):
                    break
    mock_cls.assert_not_called()
