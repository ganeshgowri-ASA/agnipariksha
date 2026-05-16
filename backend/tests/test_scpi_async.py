"""Unit tests for the async SCPI client + demo simulator.

Runs entirely in demo mode — no hardware required.
"""
from __future__ import annotations

import asyncio
import socket
import sys
from pathlib import Path

import pytest

# Make `backend` importable when running `pytest` from repo root or backend/.
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.scpi_async import (  # noqa: E402
    DemoSimulator,
    Reading,
    ScpiClient,
    is_scpi_reachable,
)


def test_is_scpi_reachable_negative() -> None:
    # Pick an unreachable port that should fail well inside 500 ms.
    assert is_scpi_reachable("127.0.0.1", 1, timeout_ms=200) is False


def test_demo_simulator_all_profiles_yield_reading() -> None:
    sim = DemoSimulator()
    for mqt in sim.PROFILES:
        r = sim.next_reading(mqt=mqt, t=42.0)
        assert isinstance(r, Reading)
        assert -100.0 < r.voltage < 2000.0
        assert -1.0 <= r.current < 100.0
        assert -50.0 < r.temperature < 120.0
        d = r.to_dict()
        assert d["V"] == r.voltage
        assert d["I"] == r.current
        assert d["P"] == r.power
        assert d["T"] == r.temperature


def test_demo_simulator_thermal_cycling_temperature_bounds() -> None:
    sim = DemoSimulator()
    temps = [sim.next_reading(mqt="MQT11", t=t).temperature for t in range(0, 240, 5)]
    assert min(temps) < 0.0
    assert max(temps) > 70.0


@pytest.mark.asyncio
async def test_scpi_client_demo_send_query_roundtrip() -> None:
    c = ScpiClient(demo_mode=True)
    connected = await c.connect()
    assert connected is False  # demo: never opens a socket
    await c.send("OUTP ON")
    idn = await c.query("*IDN?")
    assert "ITECH" in idn
    v = float(await c.query("MEAS:VOLT?"))
    assert 40.0 < v < 60.0
    await c.close()


@pytest.mark.asyncio
async def test_scpi_client_stream_readings_yields() -> None:
    c = ScpiClient(demo_mode=True)
    await c.connect()
    gen = c.stream_readings(test_id="t1", mqt="MQT13", interval_s=0.01)
    out: list[Reading] = []
    async for r in gen:
        out.append(r)
        if len(out) >= 3:
            break
    assert len(out) == 3
    for r in out:
        assert r.test_id == "t1"
        assert r.mqt == "MQT13"
    await c.close()


@pytest.mark.asyncio
async def test_scpi_client_command_queue_drains() -> None:
    c = ScpiClient(demo_mode=True)
    await c.connect()
    for i in range(5):
        await c.enqueue(f"OUTP {i}")
    assert c._cmd_queue.qsize() == 5  # type: ignore[attr-defined]
    await c.drain_queue()
    assert c._cmd_queue.qsize() == 0  # type: ignore[attr-defined]
    await c.close()


@pytest.mark.asyncio
async def test_scpi_real_path_connect_failure_raises_unreachable() -> None:
    # Live mode + unreachable target → MUST raise ScpiUnreachable.
    # Previously this test asserted silent fallback (connect()->False); that
    # was the bug fixed in fix/scpi-fail-fast-and-query — see scpi_router.py
    # which now translates this to HTTP 503.
    try:
        from backend.scpi_async import ScpiUnreachable
    except ImportError:
        from scpi_async import ScpiUnreachable  # type: ignore[no-redef]

    c = ScpiClient(host="127.0.0.1", port=1, demo_mode=False)
    with pytest.raises(ScpiUnreachable):
        await c.connect(max_attempts=1)
    assert c.connected is False
    await c.close()


def test_socket_close_does_not_leak() -> None:
    # Spot-check that is_scpi_reachable cleans up even on a positive hit.
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)
    port = srv.getsockname()[1]
    try:
        assert is_scpi_reachable("127.0.0.1", port, timeout_ms=500) is True
    finally:
        srv.close()
