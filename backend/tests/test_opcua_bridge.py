"""Tests for the OPC UA ↔ PSU bridge: DEMO closed loop, LIVE energize guard."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.opcua_bridge import (  # noqa: E402
    AMBIENT_C,
    DemoPsuSource,
    LivePsuSource,
    PsuOpcUaBridge,
    make_source,
)
from backend.app.opcua_server import (  # noqa: E402
    PsuOpcUaServer,
    PsuReadings,
    PsuSetpoints,
)


class FakeDriver:
    """Stand-in for SCPIDriver — records calls, no socket."""

    def __init__(self) -> None:
        self.v = 0.0
        self.i = 0.0
        self.out = False

    def set_voltage(self, v: float) -> None:
        self.v = v

    def set_current(self, i: float) -> None:
        self.i = i

    def output_on(self) -> None:
        self.out = True

    def output_off(self) -> None:
        self.out = False

    def measure_all(self) -> dict:
        return {"voltage": self.v, "current": self.i, "power": self.v * self.i, "timestamp": 0}


async def _settle(bridge: PsuOpcUaBridge, ticks: int) -> PsuReadings:
    last = PsuReadings()
    for _ in range(ticks):
        last = await bridge.tick()
    return last


async def test_demo_loop_tracks_setpoints_and_heats_then_cools() -> None:
    server = PsuOpcUaServer(mode="DEMO")
    await server.init()  # populate address space; no network needed
    bridge = PsuOpcUaBridge(server, DemoPsuSource())

    # Operator commands 48 V / 2 A, output ON.
    await server.set_setpoints(PsuSetpoints(voltage_v=48.0, current_a=2.0, output_enabled=True))
    on = await _settle(bridge, 40)
    assert on.voltage_v == pytest.approx(48.0, abs=0.1)
    assert on.current_a == pytest.approx(2.0, abs=0.1)
    assert on.power_w == pytest.approx(96.0, rel=0.05)
    assert on.temperature_c > AMBIENT_C  # heated under load

    # Readings were actually published to the OPC UA node.
    node_v = await server.nodes_value("Voltage_V")
    assert node_v == pytest.approx(48.0, abs=0.1)

    # Output OFF → decays back to 0 V/0 A and cools to ambient.
    await server.set_setpoints(PsuSetpoints(0.0, 0.0, output_enabled=False))
    off = await _settle(bridge, 120)
    assert off.voltage_v == pytest.approx(0.0, abs=0.05)
    assert off.current_a == pytest.approx(0.0, abs=0.05)
    assert off.temperature_c == pytest.approx(AMBIENT_C, abs=0.7)
    await server.stop()


def test_live_refuses_energize_without_permission() -> None:
    drv = FakeDriver()
    src = LivePsuSource(drv)  # allow_energize defaults False
    # Setpoints with output OFF are fine and forwarded to the PSU.
    src.apply(PsuSetpoints(voltage_v=48.0, current_a=2.0, output_enabled=False))
    assert drv.v == 48.0 and drv.i == 2.0 and drv.out is False
    # Attempting to energize without permission raises and never turns output on.
    with pytest.raises(PermissionError, match="Refusing to energize"):
        src.apply(PsuSetpoints(48.0, 2.0, output_enabled=True))
    assert drv.out is False


def test_live_energizes_only_when_explicitly_allowed() -> None:
    drv = FakeDriver()
    src = LivePsuSource(drv, allow_energize=True)
    src.apply(PsuSetpoints(12.0, 1.0, output_enabled=True))
    assert drv.out is True
    r = src.read()
    assert r.voltage_v == 12.0 and r.current_a == 1.0 and r.power_w == 12.0
    src.apply(PsuSetpoints(0.0, 0.0, output_enabled=False))
    assert drv.out is False


def test_make_source_selects_by_demo_flag() -> None:
    assert isinstance(make_source(demo=True), DemoPsuSource)
    live = make_source(demo=False, driver=FakeDriver())
    assert isinstance(live, LivePsuSource)
