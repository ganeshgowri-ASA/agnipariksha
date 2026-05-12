"""Unit and integration tests for the LeTID (IEC TS 63342) implementation."""
from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.tests.letid import (  # noqa: E402
    LeTIDConfig,
    LeTIDOrchestrator,
    analyse_result,
    fit_degradation_curve,
    simulated_iv_sweep,
)
from backend.app.tests.letid_report import render_report  # noqa: E402
from backend.scpi_async import ScpiClient  # noqa: E402
from backend.main import app  # noqa: E402


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def test_idark_dose_uses_injection_to_impp_ratio() -> None:
    cfg = LeTIDConfig(impp_stc=8.0, injection_current_a=8.0)
    iv = simulated_iv_sweep(cfg, elapsed_h=10.0)
    # Iinj == Impp → 1 sun equivalent → 10 sun·h after 10 h.
    assert iv.dose_sun_h == pytest.approx(10.0, rel=1e-3)


def test_idark_dose_scales_when_injection_greater_than_impp() -> None:
    cfg = LeTIDConfig(impp_stc=8.0, injection_current_a=12.0)
    iv = simulated_iv_sweep(cfg, elapsed_h=10.0)
    # 1.5x Impp → 15 sun·h after 10 h.
    assert iv.dose_sun_h == pytest.approx(15.0, rel=1e-3)


def test_simulated_curve_shows_initial_drop_then_recovery() -> None:
    cfg = LeTIDConfig()
    p0 = simulated_iv_sweep(cfg, 0.0).pmpp
    p_drop = simulated_iv_sweep(cfg, 60.0).pmpp
    p_late = simulated_iv_sweep(cfg, 500.0).pmpp
    # Should drop below initial, then recover at least partially.
    assert p_drop < p0
    assert p_late > p_drop


def test_fit_recovers_known_parameters() -> None:
    cfg = LeTIDConfig()
    times = [0, 6, 12, 24, 48, 72, 96, 120, 144, 162]
    pmax = [simulated_iv_sweep(cfg, t).pmpp for t in times]
    fit = fit_degradation_curve(times, pmax)
    assert fit is not None
    assert fit.rmse < 1.0  # sub-Watt RMS fit on a 333 W curve
    assert fit.tau_degrade_h > 0
    assert fit.tau_regen_h > 0


def test_analysis_marks_pass_when_loss_below_threshold() -> None:
    cfg = LeTIDConfig(total_duration_h=10.0, iv_interval_h=2.0,
                      max_allowed_loss_pct=10.0)
    from backend.app.tests.letid import LeTIDResult
    result = LeTIDResult(session_id="t", config=cfg)
    for t in [0, 2, 4, 6, 8, 10]:
        result.iv_log.append(simulated_iv_sweep(cfg, t))
    analyse_result(result)
    assert result.passed is True
    assert result.max_relative_loss_pct >= 0.0


def test_analysis_marks_fail_when_loss_exceeds_threshold() -> None:
    cfg = LeTIDConfig(max_allowed_loss_pct=0.1)  # very strict
    from backend.app.tests.letid import LeTIDResult
    result = LeTIDResult(session_id="t", config=cfg)
    for t in [0, 2, 4, 6, 8, 10]:
        result.iv_log.append(simulated_iv_sweep(cfg, t))
    analyse_result(result)
    assert result.passed is False


# ---------------------------------------------------------------------------
# Orchestrator integration (with synthetic time)
# ---------------------------------------------------------------------------


async def _run_orchestrator_fast(cfg: LeTIDConfig) -> LeTIDOrchestrator:
    """Run the orchestrator with accelerated clock so a 10 h test
    completes in a few hundred ms — keeps the suite snappy."""
    client = ScpiClient(demo_mode=True)
    await client.connect()
    base = time.monotonic()
    scale = 5000.0

    async def fast_sleep(s: float) -> None:
        await asyncio.sleep(max(s / scale, 1e-4))

    orch = LeTIDOrchestrator(
        client, cfg,
        time_source=lambda: (time.monotonic() - base) * scale,
        sleep=fast_sleep,
    )
    await orch.start()
    assert orch._task is not None
    await orch._task
    return orch


@pytest.mark.asyncio
async def test_orchestrator_records_iv_points_and_env_log(tmp_path: Path) -> None:
    cfg = LeTIDConfig(
        total_duration_h=10.0, iv_interval_h=2.0,
        telemetry_interval_s=60.0,
        output_dir=str(tmp_path),
    )
    orch = await _run_orchestrator_fast(cfg)
    # 0 h initial + 2/4/6/8/10 h → at least 5 points.
    assert len(orch.result.iv_log) >= 5
    assert len(orch.result.env_log) > 0
    # CSV + report were written under the tmp output dir.
    assert orch.result.csv_path and Path(orch.result.csv_path).exists()
    assert orch.result.report_path and Path(orch.result.report_path).exists()


@pytest.mark.asyncio
async def test_orchestrator_emits_structured_events(tmp_path: Path) -> None:
    cfg = LeTIDConfig(
        total_duration_h=6.0, iv_interval_h=2.0,
        telemetry_interval_s=120.0,
        output_dir=str(tmp_path),
    )
    captured: list[dict] = []

    async def on_event(ev: dict) -> None:
        captured.append(ev)

    client = ScpiClient(demo_mode=True)
    await client.connect()
    base = time.monotonic()
    scale = 5000.0
    orch = LeTIDOrchestrator(
        client, cfg, on_event=on_event,
        time_source=lambda: (time.monotonic() - base) * scale,
        sleep=lambda s: asyncio.sleep(max(s / scale, 1e-4)),
    )
    await orch.start()
    await orch._task

    kinds = {ev["type"] for ev in captured}
    assert {"stress_start", "iv_point", "env_sample", "stress_complete", "analysis"} <= kinds


@pytest.mark.asyncio
async def test_pause_resume_extends_total_runtime(tmp_path: Path) -> None:
    cfg = LeTIDConfig(
        total_duration_h=5.0, iv_interval_h=1.0,
        telemetry_interval_s=30.0,
        output_dir=str(tmp_path),
    )
    client = ScpiClient(demo_mode=True)
    await client.connect()
    base = time.monotonic()
    scale = 5000.0
    orch = LeTIDOrchestrator(
        client, cfg,
        time_source=lambda: (time.monotonic() - base) * scale,
        sleep=lambda s: asyncio.sleep(max(s / scale, 1e-4)),
    )
    await orch.start()
    await asyncio.sleep(0.02)
    orch.pause()
    paused_at = len(orch.result.env_log)
    await asyncio.sleep(0.05)
    # While paused, no new env samples accumulate.
    assert len(orch.result.env_log) == paused_at
    orch.resume()
    assert orch._task is not None
    await orch._task
    assert len(orch.result.env_log) > paused_at


def test_report_has_required_sections(tmp_path: Path) -> None:
    cfg = LeTIDConfig(total_duration_h=10.0, output_dir=str(tmp_path))
    from backend.app.tests.letid import LeTIDResult
    result = LeTIDResult(session_id="rep-1", config=cfg)
    for t in [0, 2, 4, 6, 8, 10]:
        result.iv_log.append(simulated_iv_sweep(cfg, t))
    analyse_result(result)
    rep = render_report(result)
    assert rep["standard"] == "IEC TS 63342:2022"
    assert "clause_references" in rep and len(rep["clause_references"]) >= 4
    assert rep["verdict"]["threshold_pct"] == cfg.max_allowed_loss_pct
    assert len(rep["pmax_vs_time"]) == len(result.iv_log)


# ---------------------------------------------------------------------------
# HTTP API
# ---------------------------------------------------------------------------


def test_api_start_returns_session_and_persists(monkeypatch: pytest.MonkeyPatch) -> None:
    with TestClient(app) as c:
        r = c.post("/api/tests/letid/start", json={
            "isc_stc": 9.5, "impp_stc": 8.9, "vmpp_stc": 37.5,
            "voc_stc": 45.0, "total_duration_h": 0.01, "iv_interval_h": 0.005,
            "telemetry_interval_s": 0.5, "demo_mode": True,
        })
        assert r.status_code == 200
        body = r.json()
        sid = body["session_id"]
        assert sid.startswith("LETID-")
        # Allow the very short run to complete.
        time.sleep(0.6)
        s = c.get(f"/api/tests/letid/{sid}").json()
        assert s["session_id"] == sid
        assert "summary" in s


def test_api_stop_unknown_session_is_handled() -> None:
    with TestClient(app) as c:
        r = c.post("/api/tests/letid/UNKNOWN/stop")
        assert r.status_code == 200
        body = r.json()
        assert body["stopped"] is False
        assert body["error"] == "unknown_session"
