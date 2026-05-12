"""Unit + integration tests for IEC 61215-2 MQT 13 — Damp Heat orchestrator.

Covers:
- Simulator stays within target ± tolerance after ramp-in.
- Analyser counts cumulative in-tolerance dwell correctly.
- Gate-2 Pmax loss decision boundaries (5 % limit).
- MQT 01 / MQT 15 stubs surface pending vs pass / fail states.
- Session loop produces a valid CSV at the reported ``raw_csv_path``.
- FastAPI ``/api/tests/damp-heat/run`` returns a well-shaped report.
"""
from __future__ import annotations

import csv
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.tests.damp_heat import (  # noqa: E402
    DampHeatAnalyzer,
    DampHeatConfig,
    DampHeatSession,
    DampHeatSimulator,
    EnvSample,
    GATE2_MAX_POWER_LOSS_PCT,
    RH_TOLERANCE_PCT,
    SAMPLE_CADENCE_S,
    TARGET_RH_PCT,
    TARGET_TEMP_C,
    TEMP_TOLERANCE_C,
)
from backend.main import app  # noqa: E402


# ---------------------------------------------------------------------------
# Simulator
# ---------------------------------------------------------------------------
def test_simulator_reaches_target_after_ramp() -> None:
    sim = DampHeatSimulator(seed=1)
    # Sample well after the 30-minute ramp completes.
    s = sim.sample(t_s=2 * 3600)  # 2 h
    assert abs(s.temperature_c - TARGET_TEMP_C) < 3.0
    assert abs(s.humidity_pct - TARGET_RH_PCT) < 6.0


def test_simulator_drift_bias_pushes_out_of_tolerance() -> None:
    sim = DampHeatSimulator(seed=2, drift_bias_temp_c=10.0)
    s = sim.sample(t_s=2 * 3600)
    assert abs(s.temperature_c - TARGET_TEMP_C) > TEMP_TOLERANCE_C


def test_simulator_trace_length_matches_cadence() -> None:
    sim = DampHeatSimulator(seed=3)
    trace = sim.trace(duration_s=3600.0, cadence_s=SAMPLE_CADENCE_S)
    # 3600 s / 60 s + 1 sample (inclusive)
    assert len(trace) == 61
    assert trace[0].t_s == 0.0
    assert trace[-1].t_s == 3600.0


def test_envsample_in_tolerance_flag() -> None:
    good = EnvSample(t_s=0, temperature_c=TARGET_TEMP_C, humidity_pct=TARGET_RH_PCT)
    bad_t = EnvSample(t_s=0, temperature_c=TARGET_TEMP_C + TEMP_TOLERANCE_C + 1, humidity_pct=TARGET_RH_PCT)
    bad_rh = EnvSample(t_s=0, temperature_c=TARGET_TEMP_C, humidity_pct=TARGET_RH_PCT - RH_TOLERANCE_PCT - 1)
    assert good.in_tolerance is True
    assert bad_t.in_tolerance is False
    assert bad_rh.in_tolerance is False


# ---------------------------------------------------------------------------
# Analyser
# ---------------------------------------------------------------------------
def _mk_samples(n: int, temp: float, rh: float) -> list[EnvSample]:
    return [EnvSample(t_s=i * 60, temperature_c=temp, humidity_pct=rh) for i in range(n)]


def test_analyser_cumulative_dwell_full_in_tolerance() -> None:
    samples = _mk_samples(120, TARGET_TEMP_C, TARGET_RH_PCT)
    a = DampHeatAnalyzer()
    total, good = a.cumulative_dwell(samples)
    assert total == 120
    assert good == 120


def test_analyser_counts_excursions() -> None:
    a = DampHeatAnalyzer()
    samples = (
        _mk_samples(10, TARGET_TEMP_C, TARGET_RH_PCT)
        + _mk_samples(5, TARGET_TEMP_C + 5, TARGET_RH_PCT)        # 5 temp excursions
        + _mk_samples(7, TARGET_TEMP_C, TARGET_RH_PCT - 10)       # 7 RH excursions
    )
    t_ex, rh_ex = a.excursions(samples)
    assert t_ex == 5
    assert rh_ex == 7


def test_gate2_pass_at_exactly_limit() -> None:
    a = DampHeatAnalyzer()
    pre = 400.0
    post = pre * (1 - GATE2_MAX_POWER_LOSS_PCT / 100.0)
    g = a.gate2(pre, post)
    assert g.status == "pass"


def test_gate2_fail_above_limit() -> None:
    a = DampHeatAnalyzer()
    g = a.gate2(400.0, 350.0)  # 12.5 % loss
    assert g.status == "fail"


def test_gate2_pending_without_pmax() -> None:
    a = DampHeatAnalyzer()
    assert a.gate2(None, None).status == "pending"
    assert a.gate2(400.0, None).status == "pending"


def test_mqt01_and_mqt15_stubs() -> None:
    a = DampHeatAnalyzer()
    assert a.mqt01_stub(0).status == "pass"
    assert a.mqt01_stub(2).status == "fail"
    assert a.mqt15_stub(None).status == "pending"
    assert a.mqt15_stub(120.0).status == "pass"
    assert a.mqt15_stub(10.0).status == "fail"


def test_full_analysis_overall_pass() -> None:
    cfg = DampHeatConfig(duration_h=1.0)  # short test window
    a = DampHeatAnalyzer(cfg)
    # 60 in-tolerance samples = 1 h dwell at 60 s cadence
    samples = _mk_samples(60, TARGET_TEMP_C, TARGET_RH_PCT)
    res = a.analyse(samples, pre_pmax=400.0, post_pmax=395.0, insulation_mohm=120.0)
    assert res.overall == "pass"
    assert res.in_tolerance_fraction == pytest.approx(1.0)
    assert res.duration_pass is True
    assert res.pmax_loss_pct == pytest.approx((400 - 395) / 400 * 100.0, rel=1e-6)


def test_full_analysis_pending_when_insulation_missing() -> None:
    cfg = DampHeatConfig(duration_h=1.0)
    a = DampHeatAnalyzer(cfg)
    samples = _mk_samples(60, TARGET_TEMP_C, TARGET_RH_PCT)
    res = a.analyse(samples, pre_pmax=400.0, post_pmax=395.0)
    assert res.mqt15.status == "pending"
    assert res.overall == "pending"


def test_full_analysis_fail_when_gate2_fails() -> None:
    cfg = DampHeatConfig(duration_h=1.0)
    a = DampHeatAnalyzer(cfg)
    samples = _mk_samples(60, TARGET_TEMP_C, TARGET_RH_PCT)
    res = a.analyse(samples, pre_pmax=400.0, post_pmax=300.0, insulation_mohm=120.0)
    assert res.gate2.status == "fail"
    assert res.overall == "fail"


# ---------------------------------------------------------------------------
# Session loop
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_session_run_produces_csv_and_report(tmp_path: Path) -> None:
    cfg = DampHeatConfig(duration_h=0.05, cadence_s=60.0)  # ~3 samples
    sim = DampHeatSimulator(seed=11)
    session = DampHeatSession(config=cfg, simulator=sim, csv_dir=tmp_path)
    session.set_pre_pmax(400.0)
    session.set_post_pmax(390.0)

    async def _no_sleep(_: float) -> None:
        return None

    report = await session.run(sleep_fn=_no_sleep, max_samples=4)

    # CSV exists with header + rows
    assert session.csv_path is not None and session.csv_path.exists()
    with session.csv_path.open() as fh:
        rows = list(csv.reader(fh))
    assert rows[0] == ["t_s", "temperature_c", "humidity_pct", "in_tolerance"]
    assert len(rows) >= 2

    # Report shape
    assert report["session_id"].startswith("DH-")
    assert report["iec_clause"].startswith("IEC 61215-2")
    assert report["raw_csv_path"] == str(session.csv_path)
    assert report["analysis"]["samples"] >= 1
    assert report["analysis"]["gate2"]["status"] in {"pass", "fail", "pending"}


@pytest.mark.asyncio
async def test_session_stop_short_circuits_loop(tmp_path: Path) -> None:
    cfg = DampHeatConfig(duration_h=100.0, cadence_s=60.0)
    session = DampHeatSession(config=cfg, csv_dir=tmp_path)

    async def _no_sleep(_: float) -> None:
        # Stop after the first sample.
        session.stop()

    report = await session.run(sleep_fn=_no_sleep, max_samples=10)
    assert report["analysis"]["samples"] <= 2


# ---------------------------------------------------------------------------
# FastAPI endpoint
# ---------------------------------------------------------------------------
def test_damp_heat_run_endpoint_returns_report() -> None:
    with TestClient(app) as c:
        r = c.post(
            "/api/tests/damp-heat/run",
            json={
                "duration_h": 0.05,           # tiny window
                "cadence_s": 60.0,
                "bias_current_a": 0.0,
                "pre_pmax_w": 400.0,
                "post_pmax_w": 395.0,
                "visual_defects": 0,
                "insulation_mohm": 120.0,
                "time_scale": 1_000_000,
                "max_samples": 4,
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["standard"] == "IEC 61215-2 MQT 13"
        assert body["iec_clause"].startswith("IEC 61215-2")
        assert "raw_csv_path" in body
        assert body["analysis"]["gate2"]["status"] in {"pass", "fail", "pending"}
        # Result for tiny window + missing duration target is "pending" (overall)
        assert body["result"] in {"PASS", "FAIL", "PENDING"}


def test_damp_heat_run_endpoint_flags_excessive_pmax_loss() -> None:
    with TestClient(app) as c:
        r = c.post(
            "/api/tests/damp-heat/run",
            json={
                "duration_h": 0.05,
                "cadence_s": 60.0,
                "pre_pmax_w": 400.0,
                "post_pmax_w": 300.0,           # 25 % loss → Gate-2 fail
                "insulation_mohm": 120.0,
                "time_scale": 1_000_000,
                "max_samples": 4,
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["analysis"]["gate2"]["status"] == "fail"
        assert body["result"] == "FAIL"
