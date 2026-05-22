"""Unit tests for the Humidity Freeze orchestrator + simulator."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.config import get_settings  # noqa: E402
from backend.orchestrators.humidity_freeze import (  # noqa: E402
    HumidityFreezeOrchestrator,
    HFState,
)
from backend.orchestrators.simulator import TestSimulator  # noqa: E402


def _make(cycles: int = 2) -> HumidityFreezeOrchestrator:
    return HumidityFreezeOrchestrator(
        module_id="MOD-HF", isc_a=9.0, cycles=cycles,
        hot_soak_s=1.0, cold_soak_s=0.5,
        ramp_rate_c_per_min=600.0,  # exceeds cap -> clamps to 200
    )


def test_demo_mode_default_and_initial_state():
    """DEMO_MODE must remain default; orchestrator boots in IDLE."""
    assert get_settings().DEMO_MODE is True
    o = _make()
    assert o.state is HFState.IDLE
    assert o.cycle_index == 0
    assert o.cycles == 2
    assert o.ramp_rate_c_per_min == 200.0  # MQT 12 cap


def test_constructor_rejects_invalid_inputs():
    with pytest.raises(ValueError):
        HumidityFreezeOrchestrator("M", isc_a=9.0, cycles=0)
    with pytest.raises(ValueError):
        HumidityFreezeOrchestrator("M", isc_a=9.0, ramp_rate_c_per_min=0)
    with pytest.raises(ValueError):
        HumidityFreezeOrchestrator("M", isc_a=9.0, t_hot_c=0, t_cold_c=0)
    with pytest.raises(ValueError):
        HumidityFreezeOrchestrator("M", isc_a=9.0, rh_pct=150)


def _drive_until_done(o: HumidityFreezeOrchestrator) -> list[HFState]:
    o.start(now_s=0.0)
    seen: list[HFState] = [o.state]
    t = 0.0
    for _ in range(20000):
        t += 0.2
        s = o.tick(t)
        if seen[-1] is not s:
            seen.append(s)
        if s is HFState.DONE:
            break
    return seen


def test_full_cycle_state_transitions():
    seen = _drive_until_done(_make(cycles=1))
    for expected in (
        HFState.SOAK_HUMID_HOT, HFState.RAMP_DOWN, HFState.SOAK_COLD,
        HFState.RAMP_UP, HFState.CYCLE_COMPLETE, HFState.DONE,
    ):
        assert expected in seen, f"missing {expected} in {seen}"


def test_cycle_count_increments():
    o = _make(cycles=3)
    _drive_until_done(o)
    assert o.state is HFState.DONE
    assert o.cycle_index == 3


def test_rh_only_active_during_humid_hot_soak():
    o = _make(cycles=1)
    o.start(now_s=0.0)
    # Hot humid soak: 85% RH active.
    assert o.rh_active_pct() == 85.0
    # Drive to SOAK_COLD: RH must be 0 (chamber dry phase).
    t = 0.0
    for _ in range(2000):
        t += 0.2
        if o.tick(t) is HFState.SOAK_COLD:
            break
    assert o.state is HFState.SOAK_COLD
    assert o.rh_active_pct() == 0.0
    assert o.current_a() == 0.0  # cold + below 25 C => 0


def test_simulator_yields_data_per_tick():
    o = _make(cycles=1)
    o.start(now_s=0.0)
    sim = TestSimulator(orchestrator=o)
    sample = sim.sample(now_s=0.05)
    assert {"t_s", "voltage_v", "current_a", "temp_c", "irradiance_w_m2"} <= sample.keys()
    assert sample["temp_c"] == 85.0
    assert sample["current_a"] == 9.0
    for i in range(4):
        sim.sample(now_s=0.1 + i * 0.05)
    assert sim.samples_emitted == 5


def test_to_dict_snapshot_shape():
    o = _make(cycles=1)
    o.start(now_s=0.0)
    d = o.to_dict()
    assert {"module_id", "state", "cycle_index", "cycles", "temp_c",
            "rh_pct", "isc_a", "current_a", "ramp_rate_c_per_min"} <= d.keys()
    assert d["module_id"] == "MOD-HF"
    assert d["state"] == HFState.SOAK_HUMID_HOT.value
    assert d["rh_pct"] == 85.0
