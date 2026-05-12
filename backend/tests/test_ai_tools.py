"""Tool-routing / dispatch tests for the AI agent."""
from __future__ import annotations

import json
import math

import pytest

from backend.app.ai import tools as agent_tools
from backend.app.db import session_scope
from backend.app.models import Module, TestRun


def _seed_bdt_run(*, vf0=0.55, vf_now=0.45, temp0=75.0) -> tuple[str, str]:
    with session_scope() as s:
        m = Module(
            manufacturer="Acme Solar",
            model="ACME-460M",
            technology="mono-PERC",
            pmax_stc=460,
            voc=49.5,
            isc=11.85,
            vmpp=41.7,
            impp=11.03,
            bypass_diode_part="PV-30SHK4",
        )
        s.add(m)
        s.commit()
        s.refresh(m)
        module_id = m.module_id

        r = TestRun(
            module_id=module_id,
            test_type="bdt",
            iec_clause="MQT18",
            status="passed",
            pass_fail="PASS",
        )
        r.params = {"vf_slope_mV_per_C": -2.0, "tj_max_c": 128.0, "ambient_c": 75}
        r.telemetry = [
            {"t": 0, "voltage": vf0, "current": 11.85, "power": vf0 * 11.85, "temperature": temp0},
            {"t": 30, "voltage": (vf0 + vf_now) / 2, "current": 11.85, "power": 0.5 * 11.85, "temperature": temp0 + 10},
            {"t": 60, "voltage": vf_now, "current": 11.85, "power": vf_now * 11.85, "temperature": temp0 + 20},
        ]
        r.summary_stats = {"tj_estimated_c": None}
        s.add(r)
        s.commit()
        s.refresh(r)
        return module_id, r.run_id


def test_get_module_round_trip(temp_db) -> None:
    module_id, _ = _seed_bdt_run()
    out = agent_tools.dispatch("get_module", {"module_id": module_id})
    assert out["manufacturer"] == "Acme Solar"
    assert out["bypass_diode_part"] == "PV-30SHK4"


def test_get_module_not_found(temp_db) -> None:
    out = agent_tools.dispatch("get_module", {"module_id": "nope"})
    assert out["error"] == "module_not_found"


def test_list_runs_filters_by_type(temp_db) -> None:
    mid, _ = _seed_bdt_run()
    with session_scope() as s:
        s.add(TestRun(module_id=mid, test_type="tc", iec_clause="MQT11", status="passed"))
        s.commit()
    out = agent_tools.dispatch("list_runs", {"module_id": mid})
    assert out["count"] == 2
    out_filtered = agent_tools.dispatch("list_runs", {"module_id": mid, "test_type": "bdt"})
    assert out_filtered["count"] == 1
    assert out_filtered["runs"][0]["test_type"] == "bdt"


def test_recompute_analysis_estimates_tj(temp_db) -> None:
    _, run_id = _seed_bdt_run(vf0=0.55, vf_now=0.45, temp0=75.0)
    out = agent_tools.dispatch("recompute_analysis", {"run_id": run_id})
    # Vf shift of 0.10 V at -2 mV/°C → +50 °C above the reference 75 °C → 125 °C.
    assert "tj_estimated_c" in out
    assert math.isclose(out["tj_estimated_c"], 125.0, abs_tol=0.5)
    assert out["tj_limit_c"] == 128.0
    assert out["tj_within_limit"] is True
    assert out["vf_slope_mV_per_C"] == -2.0


def test_suggest_pass_fail_bdt_fails_when_tj_exceeds_limit(temp_db) -> None:
    _, run_id = _seed_bdt_run(vf0=0.55, vf_now=0.30, temp0=75.0)
    # Vf shift 0.25 V → +125 °C → Tj 200 °C — well past the 128 °C limit.
    verdict = agent_tools.dispatch("suggest_pass_fail", {"run_id": run_id})
    assert verdict["verdict"] == "FAIL"
    assert verdict["clause"] == "MQT18"
    assert any("Tj" in r for r in verdict["reasons"])


def test_get_iec_clause_resolves_variants(temp_db) -> None:
    out = agent_tools.dispatch("get_iec_clause", {"clause_id": "MQT18"})
    assert out["clause_id"] == "MQT18"
    assert "bypass diode" in out["title"].lower()

    out2 = agent_tools.dispatch("get_iec_clause", {"clause_id": "bdt"})
    assert out2["clause_id"] == "MQT18"

    out3 = agent_tools.dispatch("get_iec_clause", {"clause_id": "MST 13"})
    assert out3["clause_id"] == "MST13"


def test_query_telemetry_downsamples(temp_db) -> None:
    _, run_id = _seed_bdt_run()
    with session_scope() as s:
        from backend.app.models import TestRun
        r = s.get(TestRun, run_id)
        # Inflate telemetry to 1000 samples.
        big = [{"t": i, "voltage": 0.5, "current": 1.0, "power": 0.5, "temperature": 80.0} for i in range(1000)]
        r.telemetry = big
        s.add(r)
        s.commit()
    out = agent_tools.dispatch("query_telemetry", {"run_id": run_id, "downsample": 10})
    assert out["count"] == 10


def test_dispatch_rejects_unknown_tool(temp_db) -> None:
    assert agent_tools.dispatch("not_a_tool", {})["error"] == "unknown_tool"


def test_dispatch_handles_bad_arguments(temp_db) -> None:
    out = agent_tools.dispatch("get_module", {"wrong_arg": "x"})
    assert out["error"] == "bad_arguments"
