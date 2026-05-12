"""Tests for the IEC 61730-2 MST 13 ground continuity orchestrator."""
from __future__ import annotations

import asyncio
import csv
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.tests.ground_continuity import (  # noqa: E402
    GroundContinuityConfig,
    GroundContinuityOrchestrator,
    MAX_RESISTANCE_OHM,
    MIN_TEST_CURRENT_A,
    ProbePoint,
    analyze_probe_trace,
    compute_test_current,
    simulate_probe_trace,
)
from backend.app.tests.ground_continuity_report import render_report  # noqa: E402
from backend.main import app  # noqa: E402


# ---------------------------------------------------------------------------
# Pure-math helpers
# ---------------------------------------------------------------------------
class TestComputeTestCurrent:
    def test_below_floor_uses_25a(self) -> None:
        # 2.5 * 5 = 12.5 < 25 -> floor wins.
        assert compute_test_current(5.0) == MIN_TEST_CURRENT_A

    def test_above_floor_uses_multiplier(self) -> None:
        # 2.5 * 12 = 30 > 25 -> multiplier wins.
        assert compute_test_current(12.0) == 30.0

    def test_at_boundary(self) -> None:
        assert compute_test_current(10.0) == MIN_TEST_CURRENT_A

    def test_negative_rejected(self) -> None:
        with pytest.raises(ValueError):
            compute_test_current(-1.0)


# ---------------------------------------------------------------------------
# Simulator + analysis
# ---------------------------------------------------------------------------
class TestSimulatorAndAnalysis:
    def test_simulator_produces_expected_sample_count(self) -> None:
        probe = ProbePoint("p", "P", sim_resistance_ohm=0.05)
        samples = simulate_probe_trace(
            probe, test_current_a=25.0, duration_s=10.0, sample_rate_hz=4.0,
        )
        assert len(samples) == 40

    def test_analysis_recovers_known_resistance_within_tolerance(self) -> None:
        probe = ProbePoint("p", "P", sim_resistance_ohm=0.05,
                           sim_contact_noise_ohm=0.001)
        samples = simulate_probe_trace(
            probe, test_current_a=25.0, duration_s=120.0, sample_rate_hz=5.0,
        )
        result = analyze_probe_trace(probe, samples, test_current_a=25.0)
        assert result.passed is True
        # The settle-fraction discards bedding-in transient -> within 5 mΩ.
        assert abs(result.resistance_ohm - 0.05) < 0.005
        # Contact stability should be high (low noise simulator).
        assert result.contact_stability_pct > 95.0

    def test_failing_probe_marked_fail(self) -> None:
        probe = ProbePoint("bad", "Bad", sim_resistance_ohm=0.25,
                           sim_contact_noise_ohm=0.001)
        samples = simulate_probe_trace(
            probe, test_current_a=25.0, duration_s=60.0, sample_rate_hz=5.0,
        )
        result = analyze_probe_trace(probe, samples, test_current_a=25.0)
        assert result.passed is False
        assert result.resistance_ohm > MAX_RESISTANCE_OHM


# ---------------------------------------------------------------------------
# Orchestrator end-to-end (demo path)
# ---------------------------------------------------------------------------
class TestOrchestrator:
    @pytest.mark.asyncio
    async def test_demo_run_writes_csvs_and_returns_pass(self, tmp_path: Path) -> None:
        cfg = GroundContinuityConfig(
            module_id="MOD-TEST",
            rated_module_current_a=9.0,
            duration_per_point_s=8.0,
            sample_rate_hz=5.0,
            artifact_dir=str(tmp_path),
        )
        orch = GroundContinuityOrchestrator(cfg, scpi=None, demo_mode=True)
        result = await orch.run()

        assert result.module_id == "MOD-TEST"
        assert result.test_current_a == 25.0  # 2.5*9 = 22.5 < 25
        assert len(result.probes) == 5  # default probe map
        # Each probe should have a CSV with a header + data rows.
        for p in result.probes:
            assert p.csv_path is not None
            csv_path = Path(p.csv_path)
            assert csv_path.exists()
            with csv_path.open() as fh:
                rows = list(csv.reader(fh))
            assert rows[0] == ["t_s", "voltage_v", "current_a", "probe_id", "probe_label"]
            assert len(rows) > 1
        # The default probe map all-pass.
        assert result.overall_pass is True

    @pytest.mark.asyncio
    async def test_progress_callback_receives_events(self, tmp_path: Path) -> None:
        events: list[dict] = []

        async def cb(evt: dict) -> None:
            events.append(evt)

        cfg = GroundContinuityConfig(
            duration_per_point_s=4.0, sample_rate_hz=5.0,
            artifact_dir=str(tmp_path),
        )
        orch = GroundContinuityOrchestrator(
            cfg, scpi=None, demo_mode=True, progress=cb,
        )
        await orch.run()

        kinds = [e["event"] for e in events]
        assert "session_started" in kinds
        assert kinds.count("probe_started") == 5
        assert kinds.count("probe_completed") == 5
        assert kinds[-1] == "session_completed"

    @pytest.mark.asyncio
    async def test_failing_probe_makes_overall_fail(self, tmp_path: Path) -> None:
        bad = [
            ProbePoint("ok",  "Good", sim_resistance_ohm=0.04),
            ProbePoint("bad", "Bad",  sim_resistance_ohm=0.5),
        ]
        cfg = GroundContinuityConfig(
            probe_points=bad,
            duration_per_point_s=4.0, sample_rate_hz=5.0,
            artifact_dir=str(tmp_path),
        )
        orch = GroundContinuityOrchestrator(cfg, scpi=None, demo_mode=True)
        result = await orch.run()
        verdicts = {p.probe_id: p.passed for p in result.probes}
        assert verdicts == {"ok": True, "bad": False}
        assert result.overall_pass is False


# ---------------------------------------------------------------------------
# Report rendering
# ---------------------------------------------------------------------------
class TestReport:
    @pytest.mark.asyncio
    async def test_report_file_is_written(self, tmp_path: Path) -> None:
        cfg = GroundContinuityConfig(
            duration_per_point_s=4.0, sample_rate_hz=5.0,
            artifact_dir=str(tmp_path),
        )
        orch = GroundContinuityOrchestrator(cfg, scpi=None, demo_mode=True)
        result = await orch.run()
        path = render_report(result, cfg)
        assert path.exists()
        # PDF or text fallback both acceptable.
        assert path.suffix in {".pdf", ".txt"}
        assert path.stat().st_size > 0


# ---------------------------------------------------------------------------
# HTTP API
# ---------------------------------------------------------------------------
class TestHttpApi:
    def test_probe_map_endpoint(self) -> None:
        with TestClient(app) as c:
            r = c.get("/api/tests/ground-continuity/probe-map")
            assert r.status_code == 200
            body = r.json()
            assert body["max_resistance_ohm"] == 0.1
            assert body["min_test_current_a"] == 25.0
            assert len(body["probes"]) == 5

    def test_run_endpoint_returns_pass_for_default_probes(self, tmp_path: Path) -> None:
        with TestClient(app) as c:
            r = c.post(
                "/api/tests/ground-continuity/run",
                json={
                    "module_id": "API-TEST",
                    "rated_module_current_a": 9.0,
                    "duration_per_point_s": 4.0,
                    "sample_rate_hz": 5.0,
                    "render_report": False,
                    "demo": True,
                },
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["module_id"] == "API-TEST"
            assert body["test_current_a"] == 25.0
            assert body["overall_pass"] is True
            assert body["result"] == "PASS"
            assert len(body["probes"]) == 5
            for p in body["probes"]:
                assert p["resistance_ohm"] <= 0.1
                assert p["passed"] is True
