"""Pytest coverage for the Reverse Current Overload orchestrator.

Exercises:
  * Params validation
  * Happy-path demo run (pass verdict)
  * Hotspot abort
  * Arc-event abort
  * Voltage clamp abort
  * Analysis output shape
  * Report packaging (CSV + summary + hotspot map paths exist with
    expected content)
  * HTTP endpoint /api/tests/reverse-current/run
"""
from __future__ import annotations

import asyncio
import csv
import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.tests.reverse_current import (  # noqa: E402
    AbortReason,
    DEFAULT_ABORT_T_C,
    DemoSimulator,
    ReverseCurrentOverloadTest,
    ReverseCurrentParams,
    Sample,
    analyse,
    build_demo,
    write_report,
)
from backend.main import app  # noqa: E402


# ---------------------------------------------------------------------------
# Params
# ---------------------------------------------------------------------------
def test_params_compute_test_current() -> None:
    p = ReverseCurrentParams(isc_stc_a=10.0)
    assert p.test_current_a == 13.5
    assert p.fuse_multiplier == 1.35


def test_params_validate_rejects_bad_input() -> None:
    with pytest.raises(ValueError):
        ReverseCurrentParams(isc_stc_a=0).validate()
    with pytest.raises(ValueError):
        ReverseCurrentParams(isc_stc_a=10.0, duration_s=0).validate()
    with pytest.raises(ValueError):
        ReverseCurrentParams(
            isc_stc_a=10.0, abort_temperature_c=10.0, ambient_target_c=30.0
        ).validate()
    with pytest.raises(ValueError):
        ReverseCurrentParams(isc_stc_a=10.0, voltage_clamp_v=0).validate()


# ---------------------------------------------------------------------------
# Happy-path demo run
# ---------------------------------------------------------------------------
def test_demo_happy_path_passes() -> None:
    params = ReverseCurrentParams(
        isc_stc_a=10.0, duration_s=30, sample_interval_s=1.0,
    )
    test = build_demo(params)

    async def go() -> None:
        await test.start()
        await test.join()

    asyncio.run(go())

    assert test.abort_reason == AbortReason.COMPLETED
    assert len(test.samples) >= 28  # ~30 ticks
    result = test.result()
    assert result.passed, f"unexpected failure: {result.analysis['failure_reasons']}"
    assert result.analysis["verdict"] == "PASS"
    assert result.analysis["standard"] == "IEC 61730-2 MST 26"
    assert result.analysis["test_current_a"] == 13.5
    # Surface T stays well under the abort threshold for a happy run.
    assert result.analysis["peak_surface_temperature_c"] < DEFAULT_ABORT_T_C
    assert result.analysis["ambient_in_band"] is True


# ---------------------------------------------------------------------------
# Abort paths
# ---------------------------------------------------------------------------
def test_demo_hotspot_aborts_on_over_temperature() -> None:
    params = ReverseCurrentParams(
        isc_stc_a=10.0, duration_s=2000, sample_interval_s=1.0,
        hotspot_enabled=True, hotspot_after_s=5.0,
    )
    test = build_demo(params)
    asyncio.run(_run(test))
    # Hotspot rises ~0.35 C/s; with grid surface starting near T_surface
    # it should exceed 200 C and trigger an abort within ~700 s.
    assert test.abort_reason == AbortReason.OVER_TEMPERATURE
    result = test.result()
    assert result.analysis["verdict"] == "FAIL"
    assert any("aborted" in r or "hotspot" in r for r in result.analysis["failure_reasons"])
    assert result.analysis["hotspot_event_count"] > 0


def test_demo_arc_event_aborts() -> None:
    params = ReverseCurrentParams(
        isc_stc_a=10.0, duration_s=60, sample_interval_s=1.0,
    )
    test = build_demo(params, force_arc_at_s=10.0)
    asyncio.run(_run(test))
    assert test.abort_reason == AbortReason.ARC_DETECTED
    result = test.result()
    assert result.passed is False
    assert "aborted:arc_detected" in result.analysis["failure_reasons"]


def test_voltage_clamp_breach_aborts() -> None:
    """Inject a sample with V > clamp*1.05 via a custom sampler."""
    params = ReverseCurrentParams(
        isc_stc_a=10.0, duration_s=10, sample_interval_s=1.0,
        voltage_clamp_v=10.0,
    )

    async def sampler(t_s: float) -> Sample:
        return Sample(
            t_s=t_s, current_a=13.5,
            voltage_v=20.0 if t_s >= 2 else 5.0,
            t_surface_c=40.0, t_jbox_c=45.0, t_ambient_c=30.0,
        )

    clock, sleep = _virtual_clock(step=1.0)
    test = ReverseCurrentOverloadTest(
        params, sampler=sampler, clock=clock, sleep=sleep,
    )
    asyncio.run(_run(test))
    assert test.abort_reason == AbortReason.VOLTAGE_CLAMP


def test_operator_stop() -> None:
    params = ReverseCurrentParams(isc_stc_a=10.0, duration_s=1000, sample_interval_s=1.0)
    test = build_demo(params)

    async def go() -> None:
        await test.start()
        # Let a couple of samples in, then stop.
        for _ in range(3):
            await asyncio.sleep(0)
        await test.stop(reason=AbortReason.OPERATOR_STOP)

    asyncio.run(go())
    assert test.abort_reason == AbortReason.OPERATOR_STOP


# ---------------------------------------------------------------------------
# Analyse
# ---------------------------------------------------------------------------
def test_analyse_empty_samples_returns_fail() -> None:
    params = ReverseCurrentParams(isc_stc_a=10.0, duration_s=10)
    a = analyse([], params, AbortReason.COMPLETED)
    assert a["passed"] is False
    assert "no_samples" in a["failure_reasons"]


def test_analyse_includes_iec_clauses_and_stubs() -> None:
    params = ReverseCurrentParams(isc_stc_a=10.0, duration_s=10)
    samples = [
        Sample(t_s=float(i), current_a=13.5, voltage_v=5.0,
               t_surface_c=40.0, t_jbox_c=45.0, t_ambient_c=30.0)
        for i in range(10)
    ]
    a = analyse(samples, params, AbortReason.COMPLETED)
    assert any("MST 26" in c for c in a["clauses"])
    stubs = a["post_test_stubs"]
    assert "MQT_01_visual_inspection" in stubs
    assert "MQT_15_wet_leakage" in stubs
    assert stubs["MQT_01_visual_inspection"]["status"] == "deferred"


# ---------------------------------------------------------------------------
# Report packaging
# ---------------------------------------------------------------------------
def test_write_report_creates_csv_summary_and_hotspot_map(tmp_path: Path) -> None:
    params = ReverseCurrentParams(
        isc_stc_a=10.0, duration_s=10, sample_interval_s=1.0,
    )
    sim = DemoSimulator(params)

    async def collect() -> list[Sample]:
        return [await sim(float(t)) for t in range(10)]

    samples = asyncio.run(collect())
    a = analyse(samples, params, AbortReason.COMPLETED)
    paths = write_report(tmp_path, "sess-1", params, samples, a, AbortReason.COMPLETED)

    csv_path = Path(paths["csv_path"])
    summary_path = Path(paths["summary_path"])
    hotspot_path = Path(paths["hotspot_map_path"])

    assert csv_path.exists() and csv_path.stat().st_size > 0
    # CSV has the expected header and 10 rows.
    with csv_path.open() as fh:
        rows = list(csv.reader(fh))
    assert rows[0][0] == "t_s"
    assert len(rows) == 11

    summary = json.loads(summary_path.read_text())
    assert summary["standard"] == "IEC 61730-2 MST 26"
    assert summary["analysis"]["verdict"] in {"PASS", "FAIL"}
    assert "MQT_01_visual_inspection" in summary["analysis"]["post_test_stubs"]
    assert "MST 01" in " ".join(summary["post_test_standards"])

    hotspot = json.loads(hotspot_path.read_text())
    assert hotspot["grid_size"] == 16
    assert hotspot["shape"] == [4, 4]
    assert len(hotspot["peaks_c"]) == 16


def test_run_to_completion_writes_report(tmp_path: Path) -> None:
    params = ReverseCurrentParams(isc_stc_a=10.0, duration_s=8, sample_interval_s=1.0)
    test = build_demo(params)
    result = asyncio.run(test.run_to_completion(out_dir=tmp_path))
    assert result.csv_path and Path(result.csv_path).exists()
    assert result.summary_path and Path(result.summary_path).exists()
    assert result.hotspot_map_path and Path(result.hotspot_map_path).exists()


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
def test_spec_endpoint() -> None:
    with TestClient(app) as c:
        r = c.get("/api/tests/reverse-current/spec")
        assert r.status_code == 200
        body = r.json()
        assert body["standard"] == "IEC 61730-2 MST 26"
        assert body["fuse_multiplier"] == 1.35
        assert any("MST 26" in cl for cl in body["clauses"])


def test_run_endpoint_pass() -> None:
    with TestClient(app) as c:
        r = c.post("/api/tests/reverse-current/run", json={
            "isc_stc_a": 10.0,
            "duration_s": 30,
            "sample_interval_s": 1.0,
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["analysis"]["standard"] == "IEC 61730-2 MST 26"
        assert body["analysis"]["test_current_a"] == 13.5
        assert body["sample_count"] >= 28
        assert body["analysis"]["verdict"] == "PASS"


def test_run_endpoint_validates_isc() -> None:
    with TestClient(app) as c:
        r = c.post("/api/tests/reverse-current/run", json={
            "isc_stc_a": -1,
        })
        assert r.status_code == 422  # pydantic validation


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def _run(test: ReverseCurrentOverloadTest) -> None:
    await test.start()
    await test.join()


def _virtual_clock(step: float):
    """Returns (clock, sleep) where each sleep advances the clock by `step`."""
    t = [0.0]

    def clock() -> float:
        return t[0]

    async def sleep(_d: float) -> None:
        t[0] += step
        await asyncio.sleep(0)

    return clock, sleep
