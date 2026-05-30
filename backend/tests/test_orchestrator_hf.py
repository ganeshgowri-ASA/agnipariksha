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
    chamber_uniformity,
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


def test_cycle_profile_exact_order():
    """One cycle visits the MQT 12 phases in the exact specified order."""
    seen = _drive_until_done(_make(cycles=1))
    assert seen == [
        HFState.SOAK_HUMID_HOT, HFState.RAMP_DOWN, HFState.SOAK_COLD,
        HFState.RAMP_UP, HFState.CYCLE_COMPLETE, HFState.DONE,
    ]


def test_dwell_timing_hot_and_cold():
    """Hot/cold dwells hold for their configured durations before advancing."""
    o = _make(cycles=1)  # hot_soak_s=1.0, cold_soak_s=0.5
    o.start(now_s=0.0)
    assert o.tick(0.9) is HFState.SOAK_HUMID_HOT   # before hot dwell elapses
    assert o.tick(1.0) is HFState.RAMP_DOWN        # hot dwell satisfied
    t = 1.0
    while o.state is not HFState.SOAK_COLD:
        t += 0.5
        o.tick(t)
        assert t < 1e4, "ramp_down never reached SOAK_COLD"
    enter = t
    assert o.tick(enter + 0.4) is HFState.SOAK_COLD  # before cold dwell elapses
    assert o.tick(enter + 0.5) is HFState.RAMP_UP    # cold dwell satisfied


def test_ramp_down_monotonic_and_clamped():
    """RAMP_DOWN temperature falls monotonically and clamps at t_cold."""
    o = _make(cycles=1)
    o.start(now_s=0.0)
    assert o.tick(1.0) is HFState.RAMP_DOWN
    prev = o.temp_c
    t = 1.0
    while o.state is HFState.RAMP_DOWN:
        t += 1.0
        o.tick(t)
        assert o.temp_c <= prev + 1e-9        # never warms mid-ramp
        assert o.temp_c >= o.t_cold_c - 1e-9  # never overshoots cold
        prev = o.temp_c
    assert o.state is HFState.SOAK_COLD
    assert o.temp_c == o.t_cold_c


def test_rh_enforced_only_in_hot_dwell():
    """RH holds at nominal in SOAK_HUMID_HOT and is 0 in every other phase."""
    o = _make(cycles=1)
    o.start(now_s=0.0)
    rh_by_state = {o.state: o.rh_active_pct()}
    t = 0.0
    for _ in range(5000):
        t += 0.5
        s = o.tick(t)
        rh_by_state.setdefault(s, o.rh_active_pct())
        if s is HFState.DONE:
            break
    assert rh_by_state[HFState.SOAK_HUMID_HOT] == 85.0
    for dry in (HFState.RAMP_DOWN, HFState.SOAK_COLD, HFState.RAMP_UP):
        assert rh_by_state[dry] == 0.0


def test_verdict_pending_until_done_then_manual_inputs():
    """Verdict needs all cycles done plus both manual checks; PASS needs both."""
    o = _make(cycles=1)
    assert o.verdict() == "PENDING"            # IDLE, nothing recorded
    _drive_until_done(o)
    assert o.state is HFState.DONE
    assert o.verdict() == "PENDING"            # done but awaiting inspection
    o.record_inspection(visual_pass=True, insulation_retained=False)
    assert o.verdict() == "FAIL"               # insulation not retained
    o.record_inspection(visual_pass=True, insulation_retained=True)
    assert o.verdict() == "PASS"
    assert o.to_dict()["verdict"] == "PASS"


def test_meets_spec_profile():
    """Short test config fails the MQT 12 timing reference; full config passes."""
    assert _make(cycles=10).meets_spec_profile() is False  # 60 s / 30 s dwells
    spec = HumidityFreezeOrchestrator(
        module_id="MOD-HF", isc_a=9.0, cycles=10,
        hot_soak_s=20 * 3600, cold_soak_s=30 * 60,
        ramp_rate_c_per_min=1.0,  # 125 C swing in 125 min < 4 h
    )
    assert spec.meets_spec_profile() is True


# --- Extended MQT 12 acceptance: dual ramp / ramp metrics / uniformity /
# --- tolerance bands ----------------------------------------------------

def test_dual_ramp_mode_selector():
    """MQT 12 ramp selector accepts 100 and 200 deg C/h; rejects anything else."""
    for rate in HumidityFreezeOrchestrator.ALLOWED_RAMP_C_PER_HOUR:
        o = HumidityFreezeOrchestrator.with_ramp_mode(
            ramp_c_per_hour=rate, module_id="MOD-HF", isc_a=9.0, cycles=1,
            hot_soak_s=1.0, cold_soak_s=0.5,
        )
        assert o.ramp_rate_c_per_h == rate
        assert o.ramp_rate_c_per_min == pytest.approx(rate / 60.0)
    for bad in (0, 50, 150, 300, -100):
        with pytest.raises(ValueError):
            HumidityFreezeOrchestrator.with_ramp_mode(
                ramp_c_per_hour=bad, module_id="MOD-HF", isc_a=9.0,
            )


def _drive_into_ramp_down(rate_c_per_h: int) -> HumidityFreezeOrchestrator:
    o = HumidityFreezeOrchestrator.with_ramp_mode(
        ramp_c_per_hour=rate_c_per_h, module_id="MOD-HF", isc_a=9.0, cycles=1,
        hot_soak_s=1.0, cold_soak_s=0.5,
    )
    o.start(now_s=0.0)
    o.tick(1.0)  # advance SOAK_HUMID_HOT -> RAMP_DOWN
    assert o.state is HFState.RAMP_DOWN
    return o


def test_p2p_ramp_calculation():
    """Point-to-point ramp metric approximates the SET rate within the window."""
    o = _drive_into_ramp_down(200)
    for k in range(1, 8):                # fill the 5-sample rolling window
        o.tick(1.0 + k * 60.0)
    p2p = o.ramp_actual_p2p_c_per_h()
    assert p2p is not None
    assert 190 <= p2p <= 210             # SET = 200 C/h; window is in mid-ramp


def test_cumulative_ramp_calculation():
    """Cumulative ramp metric tracks (T_now - T_phase_start) / elapsed."""
    o = _drive_into_ramp_down(100)
    o.tick(601.0)                        # 10 min into the ramp (still RAMP_DOWN)
    assert o.state is HFState.RAMP_DOWN
    cum = o.ramp_actual_cumulative_c_per_h()
    assert cum is not None
    assert 95 <= cum <= 105              # SET = 100 C/h, observed ~100 C/h


def test_chamber_uniformity_metric():
    """min/max/spread reflect the sensor-array distribution; empty -> None."""
    assert chamber_uniformity([]) == {"min": None, "max": None, "spread": None}
    u = chamber_uniformity([84.0, 85.5, 86.2, 83.8])
    assert u["min"] == 83.8
    assert u["max"] == 86.2
    assert u["spread"] == pytest.approx(2.4)


def test_tolerance_band_nonconform_trigger():
    """Any out-of-band channel (T, RH, or I) flips conformant to False."""
    o = _make(cycles=1)
    o.start(now_s=0.0)                    # SOAK_HUMID_HOT, setpoints 85 / 85 / I_inj
    i_ref = o.injected_current_a()        # ~0.001 * 9.0 = 0.009 A
    ok = o.check_tolerance(measured_t_c=84.5, measured_rh_pct=86.0, measured_i_a=i_ref)
    assert ok["conformant"] is True
    out_t = o.check_tolerance(measured_t_c=80.0, measured_rh_pct=85.0, measured_i_a=i_ref)
    assert (out_t["t_ok"], out_t["conformant"]) == (False, False)
    out_rh = o.check_tolerance(measured_t_c=85.0, measured_rh_pct=70.0, measured_i_a=i_ref)
    assert (out_rh["rh_ok"], out_rh["conformant"]) == (False, False)
    out_i = o.check_tolerance(measured_t_c=85.0, measured_rh_pct=85.0, measured_i_a=0.05)
    assert (out_i["i_ok"], out_i["conformant"]) == (False, False)
