"""Unit tests for the Thermal Cycling orchestrator + simulator."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.config import get_settings  # noqa: E402
from backend.orchestrators.simulator import TestSimulator  # noqa: E402
from backend.orchestrators.thermal_cycling import (  # noqa: E402
    ThermalCyclingOrchestrator,
    TCState,
)


def _make(cycles: int = 2) -> ThermalCyclingOrchestrator:
    return ThermalCyclingOrchestrator(
        module_id="MOD-1", isc_a=9.0, cycles=cycles, dwell_s=1.0,
        ramp_rate_c_per_min=600.0,  # exceeds cap -> clamps to 100
    )


def test_demo_mode_default_and_initial_state():
    """DEMO_MODE must remain default; orchestrator boots in IDLE."""
    assert get_settings().DEMO_MODE is True
    o = _make()
    assert o.state is TCState.IDLE
    assert o.cycle_index == 0
    assert o.ramp_rate_c_per_min == 100.0  # MQT 11 cap


def test_constructor_rejects_invalid_inputs():
    with pytest.raises(ValueError):
        ThermalCyclingOrchestrator("M", isc_a=9.0, cycles=0)
    with pytest.raises(ValueError):
        ThermalCyclingOrchestrator("M", isc_a=9.0, ramp_rate_c_per_min=0)
    with pytest.raises(ValueError):
        ThermalCyclingOrchestrator("M", isc_a=9.0, t_hot_c=0, t_cold_c=0)


def _drive_until_done(o: ThermalCyclingOrchestrator) -> list[TCState]:
    o.start(now_s=0.0)
    seen: list[TCState] = [o.state]
    t = 0.0
    for _ in range(20000):
        t += 0.5
        s = o.tick(t)
        if seen[-1] is not s:
            seen.append(s)
        if s is TCState.DONE:
            break
    return seen


def test_full_cycle_state_transitions():
    seen = _drive_until_done(_make(cycles=1))
    for expected in (
        TCState.SOAK_HOT, TCState.RAMP_DOWN, TCState.SOAK_COLD,
        TCState.RAMP_UP, TCState.CYCLE_COMPLETE, TCState.DONE,
    ):
        assert expected in seen, f"missing {expected} in {seen}"


def test_cycle_count_increments():
    o = _make(cycles=3)
    _drive_until_done(o)
    assert o.state is TCState.DONE
    assert o.cycle_index == 3


def test_current_zero_when_cold():
    o = _make(cycles=1)
    o.start(now_s=0.0)
    assert o.current_a() == 9.0
    t = 0.0
    for _ in range(2000):
        t += 0.5
        if o.tick(t) is TCState.SOAK_COLD:
            break
    assert o.state is TCState.SOAK_COLD
    assert o.current_a() == 0.0


def test_simulator_yields_data_per_tick():
    o = _make(cycles=1)
    o.start(now_s=0.0)
    sim = TestSimulator(orchestrator=o)
    sample = sim.sample(now_s=0.1)
    assert {"t_s", "voltage_v", "current_a", "temp_c", "irradiance_w_m2"} <= sample.keys()
    assert sample["temp_c"] == 85.0
    assert sample["current_a"] == 9.0
    for i in range(5):
        sim.sample(now_s=0.2 + i * 0.1)
    assert sim.samples_emitted == 6


def test_to_dict_snapshot_shape():
    o = _make(cycles=1)
    o.start(now_s=0.0)
    d = o.to_dict()
    assert {"module_id", "state", "cycle_index", "cycles", "temp_c",
            "isc_a", "current_a", "ramp_rate_c_per_min"} <= d.keys()
    assert d["module_id"] == "MOD-1"
    assert d["state"] == TCState.SOAK_HOT.value
