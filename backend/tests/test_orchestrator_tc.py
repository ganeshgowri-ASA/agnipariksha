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


# Sim steps now_s in coarse increments: a compliant 100 C/h ramp spans
# ~75 min of sim-time per leg, so a fine wall-clock step is unnecessary.
SIM_DT_S = 60.0


def _make(cycles: int = 2) -> ThermalCyclingOrchestrator:
    return ThermalCyclingOrchestrator(
        module_id="MOD-1", imp_a=9.0, cycles=cycles, dwell_s=1.0,
        ramp_rate_c_per_h=600.0,  # exceeds cap -> clamps to 100
    )


def test_demo_mode_default_and_initial_state():
    """DEMO_MODE must remain default; orchestrator boots in IDLE."""
    assert get_settings().DEMO_MODE is True
    o = _make()
    assert o.state is TCState.IDLE
    assert o.cycle_index == 0
    assert o.ramp_rate_c_per_h == 100.0  # MQT 11 cap (deg C / hour)


def test_constructor_rejects_invalid_inputs():
    with pytest.raises(ValueError):
        ThermalCyclingOrchestrator("M", imp_a=9.0, cycles=0)
    with pytest.raises(ValueError):
        ThermalCyclingOrchestrator("M", imp_a=9.0, ramp_rate_c_per_h=0)
    with pytest.raises(ValueError):
        ThermalCyclingOrchestrator("M", imp_a=9.0, dwell_s=0)
    with pytest.raises(ValueError):
        ThermalCyclingOrchestrator("M", imp_a=9.0, t_hot_c=0, t_cold_c=0)


def _drive_until_done(o: ThermalCyclingOrchestrator) -> list[TCState]:
    o.start(now_s=0.0)
    seen: list[TCState] = [o.state]
    t = 0.0
    for _ in range(20000):
        t += SIM_DT_S
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
        t += SIM_DT_S
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
            "imp_a", "current_a", "ramp_rate_c_per_h", "dwell_s",
            "verdict"} <= d.keys()
    assert d["module_id"] == "MOD-1"
    assert d["state"] == TCState.SOAK_HOT.value


# --- MQT 11 acceptance-criteria coverage ---------------------------------

def _compliant(cycles: int = 1) -> ThermalCyclingOrchestrator:
    """MQT 11-compliant config: 10-min dwell, 100 C/h ramp, -40..+85 C."""
    return ThermalCyclingOrchestrator(
        module_id="MOD-C", imp_a=8.5, cycles=cycles,
        dwell_s=600.0, ramp_rate_c_per_h=100.0,
    )


def test_dwell_holds_for_full_ten_minutes():
    """SOAK_HOT holds the full >= 10-min dwell before ramping down."""
    o = _compliant()
    o.start(now_s=0.0)
    assert o.state is TCState.SOAK_HOT
    o.tick(now_s=599.0)               # 1 s short of the 600 s dwell
    assert o.state is TCState.SOAK_HOT
    assert o.temp_c == 85.0           # held at hot extreme
    o.tick(now_s=600.0)               # dwell satisfied
    assert o.state is TCState.RAMP_DOWN


def test_ramp_rate_clamped_to_mqt11_cap():
    """Over-spec ramp clamps to 100 C/h and the observed slope obeys it."""
    o = ThermalCyclingOrchestrator("M", imp_a=8.0, ramp_rate_c_per_h=100000.0)
    assert o.ramp_rate_c_per_h == 100.0
    o.start(now_s=0.0)
    o.tick(now_s=600.0)               # -> RAMP_DOWN
    assert o.state is TCState.RAMP_DOWN
    t_prev, temp_prev = 600.0, o.temp_c
    for k in range(1, 80):
        t = 600.0 + k * 60.0
        o.tick(t)
        slope = abs(o.temp_c - temp_prev) / ((t - t_prev) / 3600.0)
        assert slope <= o.RAMP_RATE_CAP + 1e-6
        t_prev, temp_prev = t, o.temp_c
        if o.state is not TCState.RAMP_DOWN:
            break


def test_cycle_profile_reaches_both_extremes():
    """A full cycle visits both the -40 C and +85 C extremes."""
    o = _compliant(cycles=1)
    o.start(now_s=0.0)
    temps, t = [o.temp_c], 0.0
    for _ in range(20000):
        t += SIM_DT_S
        o.tick(t)
        temps.append(o.temp_c)
        if o.state is TCState.DONE:
            break
    assert max(temps) == 85.0
    assert min(temps) == -40.0
    assert o.state is TCState.DONE


def test_current_is_imp_setpoint_when_hot():
    """Injected current is the Imp setpoint (NON-IV), not Isc."""
    o = ThermalCyclingOrchestrator("M", imp_a=8.5, cycles=1, dwell_s=1.0)
    o.start(now_s=0.0)                # SOAK_HOT, T = 85 C
    assert o.current_a() == 8.5
    assert o.to_dict()["imp_a"] == 8.5


def test_short_dwell_marks_profile_non_compliant():
    """Dwell < 10 min fails the MQT 11 profile check; 10 min passes."""
    short = ThermalCyclingOrchestrator("M", imp_a=8.0, dwell_s=60.0)
    assert short.profile_compliant() is False
    assert _compliant().profile_compliant() is True


def test_verdict_requires_completion_compliance_and_manual_checks():
    """PASS needs DONE + compliant profile + both manual checkboxes."""
    o = _compliant(cycles=1)
    assert o.verdict() == "INCOMPLETE"
    _drive_until_done(o)
    assert o.state is TCState.DONE
    assert o.verdict() == "FAIL"          # manual checks unset
    o.manual_visual_pass = True
    o.manual_insulation_retained = True
    assert o.verdict() == "PASS"
    assert o.to_dict()["verdict"] == "PASS"
