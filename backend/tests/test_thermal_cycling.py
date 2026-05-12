"""Unit tests for IEC 61215-2 MQT 11 orchestrator + analysis."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.tests.thermal_cycling import (  # noqa: E402
    GATE2_DELTA_PMAX_PERCENT,
    MAX_RAMP_C_PER_HOUR,
    MIN_DWELL_SECONDS,
    TCConfig,
    TCSample,
    TCState,
    analyze,
    make_demo_orchestrator,
    scan_discontinuities,
)
from backend.scpi_async import DemoSimulator  # noqa: E402


# ---------------------------------------------------------------------------
# Config validation
# ---------------------------------------------------------------------------
def test_tcconfig_default_is_iec_compliant() -> None:
    c = TCConfig()
    assert c.cycles == 200
    assert c.t_hot_c == 85.0
    assert c.t_cold_c == -40.0
    assert c.ramp_rate_c_per_h == MAX_RAMP_C_PER_HOUR
    assert c.hot_dwell_s == MIN_DWELL_SECONDS
    assert c.cold_dwell_s == MIN_DWELL_SECONDS


def test_tcconfig_rejects_excessive_ramp_rate() -> None:
    with pytest.raises(ValueError, match="ramp_rate"):
        TCConfig(ramp_rate_c_per_h=150.0)


def test_tcconfig_rejects_too_short_dwell() -> None:
    with pytest.raises(ValueError, match="dwell"):
        TCConfig(hot_dwell_s=59)


def test_tcconfig_rejects_inverted_temp_range() -> None:
    with pytest.raises(ValueError, match="t_hot_c"):
        TCConfig(t_hot_c=-20, t_cold_c=10)


def test_tcconfig_imp_per_technology() -> None:
    assert TCConfig(technology="c-Si").imp() == pytest.approx(9.5)
    assert TCConfig(technology="cdte").imp() == pytest.approx(2.05)
    # explicit override wins
    assert TCConfig(technology="cdte", imp_a=4.2).imp() == pytest.approx(4.2)
    # unknown technology falls back to c-Si
    assert TCConfig(technology="unobtanium").imp() > 0


# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_orchestrator_runs_all_four_states_per_cycle() -> None:
    cfg = TCConfig(
        cycles=2,
        ramp_rate_c_per_h=100.0,
        hot_dwell_s=MIN_DWELL_SECONDS,
        cold_dwell_s=MIN_DWELL_SECONDS,
        time_scale=10_000.0,         # collapse wall time
        sample_interval_s=5.0,
    )
    orch = make_demo_orchestrator(cfg=cfg)
    states: list[str] = []
    async for s in orch.stream():
        if not states or s.state != states[-1]:
            states.append(s.state)
    assert orch.state == TCState.DONE
    expected = ["heating", "dwell_hot", "cooling", "dwell_cold"] * cfg.cycles
    assert states == expected, states
    assert len(orch.cycle_log) == cfg.cycles


@pytest.mark.asyncio
async def test_orchestrator_abort_transitions_to_aborted() -> None:
    cfg = TCConfig(
        cycles=10,
        time_scale=1_000.0,
        sample_interval_s=5.0,
    )
    orch = make_demo_orchestrator(cfg=cfg)

    async def runner():
        async for _ in orch.stream():
            if orch.cycle == 1 and orch.state == TCState.DWELL_HOT:
                orch.abort()

    await asyncio.wait_for(runner(), timeout=30.0)
    assert orch.state == TCState.ABORTED


# ---------------------------------------------------------------------------
# Ramp-rate enforcement
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_ramp_rate_never_exceeds_iec_limit() -> None:
    cfg = TCConfig(
        cycles=1, time_scale=10_000.0, sample_interval_s=5.0,
        ramp_rate_c_per_h=100.0,
    )
    orch = make_demo_orchestrator(cfg=cfg)
    await orch.run_to_completion()
    for row in orch.cycle_log:
        assert abs(row.avg_ramp_up_c_per_h) <= MAX_RAMP_C_PER_HOUR + 1.0
        assert abs(row.avg_ramp_down_c_per_h) <= MAX_RAMP_C_PER_HOUR + 1.0


# ---------------------------------------------------------------------------
# Demo curve sanity
# ---------------------------------------------------------------------------
def test_demo_simulator_mqt11_profile_hits_both_extremes() -> None:
    sim = DemoSimulator()
    # period for MQT11 is 120 s — sample one full cycle.
    samples = [(t, sim.next_reading(mqt="MQT11", t=float(t))) for t in range(0, 480, 1)]
    temps = [s.temperature for _, s in samples]
    assert min(temps) < -30.0          # reaches the -40 °C plateau
    assert max(temps) > 75.0           # reaches the +85 °C plateau
    # Cool-down arc lives in 0.50 <= phase < 0.90 of the 120 s period.
    period = 120.0
    cool_currents = [
        s.current for t, s in samples
        if 0.55 <= ((t % period) / period) < 0.85
    ]
    heat_currents = [
        s.current for t, s in samples
        if 0.05 <= ((t % period) / period) < 0.35
    ]
    assert max(heat_currents) > 8.0, max(heat_currents)
    assert max(cool_currents) < 1.0, max(cool_currents)


def test_demo_simulator_mqt11_has_realistic_noise() -> None:
    sim = DemoSimulator()
    period = 120.0
    # Restrict to the hot-plateau window (0.40..0.50 of phase) to isolate
    # sensor noise from the ramp signal.
    temps_at_plateau = []
    for t in range(0, 2400):
        phase = (t % period) / period
        if 0.40 <= phase < 0.50:
            temps_at_plateau.append(sim.next_reading(mqt="MQT11", t=float(t)).temperature)
    assert temps_at_plateau, "plateau samples should exist"
    mean = sum(temps_at_plateau) / len(temps_at_plateau)
    deviations = [(t - mean) ** 2 for t in temps_at_plateau]
    rms = (sum(deviations) / len(deviations)) ** 0.5
    assert 0.05 < rms < 1.0, rms


# ---------------------------------------------------------------------------
# Discontinuity scan
# ---------------------------------------------------------------------------
def _mk(set_i: float, meas_i: float, v: float, t: float = 25.0) -> TCSample:
    return TCSample(
        ts_ms=0, sim_s=0.0, cycle=1, state="heating",
        temperature_c=t, current_a=meas_i, voltage_v=v, set_current_a=set_i,
    )


def test_discontinuity_scan_flags_open_circuit_and_voltage_jump() -> None:
    samples = [
        _mk(9.5, 9.4, 45.0),
        _mk(9.5, 0.05, 45.0),   # current discontinuity (open)
        _mk(9.5, 9.4, 50.0),    # voltage jump >= 1 V
        _mk(9.5, 9.4, 50.1),
    ]
    i_disc, v_disc = scan_discontinuities(samples)
    assert i_disc == 1
    assert v_disc >= 1


def test_discontinuity_scan_ignores_low_bias_currents() -> None:
    # In the cool-down / cold-dwell window the set current is tiny (1 %),
    # so noisy meas values must NOT count as open-circuit events.
    samples = [_mk(0.04, 0.0, 45.0) for _ in range(20)]
    i_disc, _ = scan_discontinuities(samples)
    assert i_disc == 0


# ---------------------------------------------------------------------------
# Pass/Fail vs Gate 2
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_pass_when_completed_and_pmax_within_5pct() -> None:
    cfg = TCConfig(
        cycles=1, time_scale=10_000.0, sample_interval_s=5.0,
        pre_test_pmax_w=400.0,
    )
    orch = make_demo_orchestrator(cfg=cfg)
    await orch.run_to_completion()
    a = analyze(orch, post_pmax_w=395.0)  # -1.25 %
    assert a.pass_fail == "PASS", a.reasons
    assert a.delta_pmax_percent == pytest.approx(-1.25, abs=0.01)
    assert a.gate2_threshold_percent == GATE2_DELTA_PMAX_PERCENT


@pytest.mark.asyncio
async def test_fail_when_pmax_drop_exceeds_gate2() -> None:
    cfg = TCConfig(
        cycles=1, time_scale=10_000.0, sample_interval_s=5.0,
        pre_test_pmax_w=400.0,
    )
    orch = make_demo_orchestrator(cfg=cfg)
    await orch.run_to_completion()
    a = analyze(orch, post_pmax_w=370.0)  # -7.5 %
    assert a.pass_fail == "FAIL"
    assert any("Gate 2" in r for r in a.reasons)


@pytest.mark.asyncio
async def test_fail_when_aborted() -> None:
    cfg = TCConfig(
        cycles=2, time_scale=1_000.0, sample_interval_s=5.0,
        pre_test_pmax_w=400.0,
    )
    orch = make_demo_orchestrator(cfg=cfg)

    async def driver():
        async for _ in orch.stream():
            if orch.cycle == 1 and orch.state == TCState.HEATING:
                orch.abort()

    await asyncio.wait_for(driver(), timeout=30.0)
    a = analyze(orch, post_pmax_w=399.0)
    assert a.pass_fail == "FAIL"
    assert any("aborted" in r for r in a.reasons)


# ---------------------------------------------------------------------------
# HTTP control plane
# ---------------------------------------------------------------------------
def test_tc_start_endpoint_returns_session_id_and_csv_path() -> None:
    from fastapi.testclient import TestClient
    from backend.main import app

    with TestClient(app) as c:
        r = c.post("/api/tests/thermal-cycling/start", json={
            "cycles": 2, "time_scale": 1000.0, "sample_interval_s": 5.0,
            "pre_test_pmax_w": 400.0,
        })
        assert r.status_code == 200
        body = r.json()
        assert body["session_id"].startswith("TC-")
        assert body["standard"] == "IEC 61215-2 MQT 11"
        assert body["clause"] == "4.11"
        assert body["gate2_threshold_percent"] == -5.0
        assert body["raw_csv_path"].endswith(".csv")


def test_tc_start_rejects_invalid_ramp_rate() -> None:
    from fastapi.testclient import TestClient
    from backend.main import app

    with TestClient(app) as c:
        r = c.post("/api/tests/thermal-cycling/start", json={
            "ramp_rate_c_per_h": 250.0,
        })
        assert r.status_code == 200
        assert r.json().get("error") == "invalid_config"


@pytest.mark.asyncio
async def test_raw_csv_is_emitted_with_absolute_path(tmp_path) -> None:
    out = tmp_path / "tc_raw.csv"
    cfg = TCConfig(cycles=1, time_scale=10_000.0, sample_interval_s=5.0)
    orch = make_demo_orchestrator(cfg=cfg, raw_csv_path=out)
    await orch.run_to_completion()
    assert out.exists()
    assert out.is_absolute()
    content = out.read_text().splitlines()
    assert content[0].startswith("ts_ms,sim_s,cycle,state,")
    assert len(content) > 1
