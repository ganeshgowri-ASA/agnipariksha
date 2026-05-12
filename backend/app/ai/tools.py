"""Tool implementations exposed to the AI agent.

Every tool is a plain Python function with typed args. The dispatcher
in ``agent.py`` resolves the JSON schema and routes Claude's tool calls
here. Each function returns a JSON-serialisable dict.

Tools intentionally operate over the same SQLite store the routers use,
so anything created via the REST API is immediately visible to the
agent.
"""
from __future__ import annotations

import json
import math
import statistics
from pathlib import Path
from typing import Any

from sqlmodel import select

from ..db import session_scope
from ..models import Module, TestRun

CLAUSES_PATH = Path(__file__).resolve().parent.parent / "data" / "iec_clauses.json"


def _load_clauses() -> dict[str, dict[str, Any]]:
    return json.loads(CLAUSES_PATH.read_text())


def _module_payload(m: Module) -> dict[str, Any]:
    return {
        "module_id": m.module_id,
        "manufacturer": m.manufacturer,
        "model": m.model,
        "technology": m.technology,
        "pmax_stc": m.pmax_stc,
        "voc": m.voc,
        "isc": m.isc,
        "vmpp": m.vmpp,
        "impp": m.impp,
        "bifaciality": m.bifaciality,
        "area_m2": m.area_m2,
        "junction_box": m.junction_box,
        "bypass_diode_part": m.bypass_diode_part,
        "datasheet_url": m.datasheet_url,
        "notes": m.notes,
    }


def _run_payload(r: TestRun) -> dict[str, Any]:
    return {
        "run_id": r.run_id,
        "module_id": r.module_id,
        "test_type": r.test_type,
        "iec_clause": r.iec_clause,
        "params": r.params,
        "started_at": r.started_at.isoformat() if r.started_at else None,
        "ended_at": r.ended_at.isoformat() if r.ended_at else None,
        "status": r.status,
        "summary_stats": r.summary_stats,
        "pass_fail": r.pass_fail,
        "operator": r.operator,
        "telemetry_points": len(r.telemetry),
    }


# ---------------------------------------------------------------------------
# Tool: get_module
# ---------------------------------------------------------------------------
def get_module(module_id: str) -> dict[str, Any]:
    with session_scope() as s:
        m = s.get(Module, module_id)
        if not m:
            return {"error": "module_not_found", "module_id": module_id}
        return _module_payload(m)


# ---------------------------------------------------------------------------
# Tool: list_runs
# ---------------------------------------------------------------------------
def list_runs(module_id: str, test_type: str | None = None) -> dict[str, Any]:
    with session_scope() as s:
        stmt = select(TestRun).where(TestRun.module_id == module_id)
        if test_type:
            stmt = stmt.where(TestRun.test_type == test_type)
        rows = s.exec(stmt).all()
        return {"runs": [_run_payload(r) for r in rows], "count": len(rows)}


# ---------------------------------------------------------------------------
# Tool: get_run
# ---------------------------------------------------------------------------
def get_run(run_id: str) -> dict[str, Any]:
    with session_scope() as s:
        r = s.get(TestRun, run_id)
        if not r:
            return {"error": "run_not_found", "run_id": run_id}
        return _run_payload(r)


# ---------------------------------------------------------------------------
# Tool: query_telemetry
# ---------------------------------------------------------------------------
def query_telemetry(
    run_id: str,
    t_start: float | None = None,
    t_end: float | None = None,
    downsample: int = 100,
) -> dict[str, Any]:
    with session_scope() as s:
        r = s.get(TestRun, run_id)
        if not r:
            return {"error": "run_not_found", "run_id": run_id}
        rows = r.telemetry
    if t_start is not None:
        rows = [p for p in rows if p.get("t", 0) >= t_start]
    if t_end is not None:
        rows = [p for p in rows if p.get("t", 0) <= t_end]
    if downsample and len(rows) > downsample:
        step = max(1, len(rows) // downsample)
        rows = rows[::step]
    return {"run_id": run_id, "samples": rows, "count": len(rows)}


# ---------------------------------------------------------------------------
# Tool: recompute_analysis
# ---------------------------------------------------------------------------
def recompute_analysis(run_id: str) -> dict[str, Any]:
    """Cheap, in-process Gate-2 / Tj recompute from the stored telemetry."""
    with session_scope() as s:
        r = s.get(TestRun, run_id)
        if not r:
            return {"error": "run_not_found", "run_id": run_id}
        rows = r.telemetry
        params = r.params
        module = s.get(Module, r.module_id)

    if not rows:
        return {"run_id": run_id, "warning": "no_telemetry"}

    powers = [p["power"] for p in rows if "power" in p]
    currents = [p["current"] for p in rows if "current" in p]
    voltages = [p["voltage"] for p in rows if "voltage" in p]
    temps = [p["temperature"] for p in rows if p.get("temperature") is not None]

    out: dict[str, Any] = {
        "run_id": run_id,
        "test_type": r.test_type,
        "samples": len(rows),
    }
    if powers:
        out["p_max_w"] = max(powers)
        out["p_avg_w"] = statistics.fmean(powers)
        out["p_first_w"] = powers[0]
        out["p_last_w"] = powers[-1]
        if powers[0] > 0:
            out["pmax_delta_pct"] = (powers[-1] - powers[0]) / powers[0] * 100
            out["gate2_pass"] = out["pmax_delta_pct"] >= -5.0
    if currents:
        out["i_max_a"] = max(currents)
    if voltages:
        out["v_avg_v"] = statistics.fmean(voltages)
    if temps:
        out["temp_max_c"] = max(temps)
        out["temp_avg_c"] = statistics.fmean(temps)

    # Bypass diode Tj estimation: Vf shift relative to first sample at known
    # reference Tj (assume ambient at t=0), -2 mV/°C silicon coefficient.
    if r.test_type == "bdt" and voltages and temps:
        vf0 = voltages[0]
        tj0 = temps[0]
        slope = float(params.get("vf_slope_mV_per_C", -2.0))  # mV/°C
        # Tj = Tj0 + (Vf0 - Vf_now) / |slope|  with slope in V/°C
        slope_v = abs(slope) / 1000.0
        tj_now = tj0 + (vf0 - voltages[-1]) / slope_v
        out["tj_estimated_c"] = tj_now
        out["vf_slope_mV_per_C"] = slope
        tj_limit = float(params.get("tj_max_c", 128.0))
        out["tj_limit_c"] = tj_limit
        out["tj_within_limit"] = tj_now < tj_limit
        if module:
            out["bypass_diode_part"] = module.bypass_diode_part

    return out


# ---------------------------------------------------------------------------
# Tool: suggest_pass_fail
# ---------------------------------------------------------------------------
def suggest_pass_fail(run_id: str) -> dict[str, Any]:
    analysis = recompute_analysis(run_id)
    if "error" in analysis:
        return analysis

    test_type = analysis.get("test_type")
    clauses = _load_clauses()
    clause = next((c for c in clauses.values() if c.get("test_type") == test_type), None)
    verdict = "INDETERMINATE"
    reasons: list[str] = []

    if test_type in {"tc", "hf", "dh", "letid"}:
        delta = analysis.get("pmax_delta_pct")
        if delta is None:
            reasons.append("Pmax delta not computable — missing power samples.")
        else:
            limit = -5.0 if test_type != "letid" else -2.0
            if delta >= limit:
                verdict = "PASS"
                reasons.append(f"Pmax delta {delta:.2f}% >= {limit:.1f}% threshold.")
            else:
                verdict = "FAIL"
                reasons.append(f"Pmax delta {delta:.2f}% breaches {limit:.1f}% threshold (Gate 2).")
    elif test_type == "bdt":
        tj = analysis.get("tj_estimated_c")
        tj_limit = analysis.get("tj_limit_c", 128.0)
        if tj is None:
            reasons.append("Tj not estimable — telemetry missing Vf or temperature.")
        elif math.isnan(tj):
            reasons.append("Tj estimate produced NaN — check Vf slope and reference temperature.")
        elif tj < tj_limit:
            verdict = "PASS"
            reasons.append(f"Estimated Tj {tj:.1f} °C < {tj_limit:.0f} °C limit (IEC 62979 / MQT 18).")
        else:
            verdict = "FAIL"
            reasons.append(f"Estimated Tj {tj:.1f} °C >= {tj_limit:.0f} °C limit — thermal runaway risk.")
    elif test_type == "gct":
        # Resistance = mean V / mean I if I > 0
        v = analysis.get("v_avg_v")
        i_max = analysis.get("i_max_a")
        if v is not None and i_max:
            r = v / i_max if i_max else float("inf")
            if r < 0.1 and v <= 2.5:
                verdict = "PASS"
                reasons.append(f"R = {r:.4f} Ohm < 0.1 and Vdrop {v:.2f} V <= 2.5 V.")
            else:
                verdict = "FAIL"
                reasons.append(f"R = {r:.4f} Ohm, Vdrop = {v:.2f} V violates MST 13 limits.")
    elif test_type == "rco":
        # Pass criterion is qualitative ("no fire") — we just look at status
        with session_scope() as s:
            r = s.get(TestRun, run_id)
            if r and r.status == "passed":
                verdict = "PASS"
                reasons.append("Operator reported no fire / no sustained arcing per MST 26.")
            elif r and r.status == "failed":
                verdict = "FAIL"
                reasons.append("Operator reported safety breach per MST 26.")

    return {
        "run_id": run_id,
        "verdict": verdict,
        "reasons": reasons,
        "analysis": analysis,
        "clause": clause["clause_id"] if clause else None,
    }


# ---------------------------------------------------------------------------
# Tool: get_iec_clause
# ---------------------------------------------------------------------------
def get_iec_clause(clause_id: str) -> dict[str, Any]:
    clauses = _load_clauses()
    if clause_id in clauses:
        return clauses[clause_id]
    # Case-insensitive lookup
    norm = clause_id.replace(" ", "").upper()
    for k, v in clauses.items():
        if k.upper() == norm:
            return v
    # Try by test_type
    for v in clauses.values():
        if v.get("test_type") == clause_id.lower():
            return v
    return {"error": "clause_not_found", "clause_id": clause_id, "available": list(clauses.keys())}


# ---------------------------------------------------------------------------
# Tool: compare_runs
# ---------------------------------------------------------------------------
def compare_runs(run_ids: list[str]) -> dict[str, Any]:
    summaries = [recompute_analysis(rid) for rid in run_ids]
    deltas = [s.get("pmax_delta_pct") for s in summaries if "pmax_delta_pct" in s]
    return {
        "run_ids": run_ids,
        "per_run": summaries,
        "delta_summary": {
            "min_pct": min(deltas) if deltas else None,
            "max_pct": max(deltas) if deltas else None,
            "mean_pct": statistics.fmean(deltas) if deltas else None,
        },
    }


# ---------------------------------------------------------------------------
# Schema + dispatcher
# ---------------------------------------------------------------------------
TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "name": "get_module",
        "description": "Fetch the full datasheet record (Pmax, Voc, Isc, Vmpp, Impp, bypass diode part, technology) for one PV module.",
        "input_schema": {
            "type": "object",
            "properties": {"module_id": {"type": "string"}},
            "required": ["module_id"],
        },
    },
    {
        "name": "list_runs",
        "description": "List historical test runs for a module, optionally filtered to one test type (tc, hf, letid, bdt, rco, gct, dh).",
        "input_schema": {
            "type": "object",
            "properties": {
                "module_id": {"type": "string"},
                "test_type": {"type": "string"},
            },
            "required": ["module_id"],
        },
    },
    {
        "name": "get_run",
        "description": "Fetch one TestRun by id with its parameters, summary stats and pass/fail.",
        "input_schema": {
            "type": "object",
            "properties": {"run_id": {"type": "string"}},
            "required": ["run_id"],
        },
    },
    {
        "name": "query_telemetry",
        "description": "Return time-series samples for a run, optionally bounded by t_start/t_end (epoch seconds) and downsampled to ~N points.",
        "input_schema": {
            "type": "object",
            "properties": {
                "run_id": {"type": "string"},
                "t_start": {"type": "number"},
                "t_end": {"type": "number"},
                "downsample": {"type": "integer", "default": 100},
            },
            "required": ["run_id"],
        },
    },
    {
        "name": "recompute_analysis",
        "description": "Re-run the canonical analysis on a TestRun: peak/avg power, Pmax delta vs first sample (Gate 2), and for bdt the estimated diode Tj from Vf shift using the -2 mV/°C silicon coefficient.",
        "input_schema": {
            "type": "object",
            "properties": {"run_id": {"type": "string"}},
            "required": ["run_id"],
        },
    },
    {
        "name": "suggest_pass_fail",
        "description": "Recommend PASS/FAIL with reasons against the IEC clause applicable to that test type.",
        "input_schema": {
            "type": "object",
            "properties": {"run_id": {"type": "string"}},
            "required": ["run_id"],
        },
    },
    {
        "name": "get_iec_clause",
        "description": "Look up an IEC clause excerpt and pass/fail criterion. clause_id is e.g. MQT11, MQT18, TS63342, MST13.",
        "input_schema": {
            "type": "object",
            "properties": {"clause_id": {"type": "string"}},
            "required": ["clause_id"],
        },
    },
    {
        "name": "compare_runs",
        "description": "Compute side-by-side analyses for several runs.",
        "input_schema": {
            "type": "object",
            "properties": {
                "run_ids": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["run_ids"],
        },
    },
]


TOOL_DISPATCH = {
    "get_module": get_module,
    "list_runs": list_runs,
    "get_run": get_run,
    "query_telemetry": query_telemetry,
    "recompute_analysis": recompute_analysis,
    "suggest_pass_fail": suggest_pass_fail,
    "get_iec_clause": get_iec_clause,
    "compare_runs": compare_runs,
}


def dispatch(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    fn = TOOL_DISPATCH.get(name)
    if not fn:
        return {"error": "unknown_tool", "name": name}
    try:
        return fn(**(arguments or {}))
    except TypeError as exc:
        return {"error": "bad_arguments", "name": name, "detail": str(exc)}
    except Exception as exc:  # pragma: no cover - defensive
        return {"error": "tool_failure", "name": name, "detail": str(exc)}
