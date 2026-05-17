"""Tests for the threaded per-Module AI assistant.

Covers:
* Thread storage keyed by Module ID (incl. cross-module isolation).
* Each of the four tool calls against seed data.
* The deterministic intent router that picks which tools to invoke.
* The SSE streaming endpoint: meta -> tool_call -> tool_result -> token -> done.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from typing import Iterator, List, Tuple

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from backend.assistant import (
    GATE2_PMAX_DELTA_PERCENT,
    THREAD_TITLE_PREFIX,
    _ensure_messages_list,
    append_messages,
    clear_thread,
    get_or_create_thread,
    plan_tool_calls,
    tool_get_run,
    tool_query_telemetry,
    tool_recompute_analysis,
    tool_suggest_pass_fail,
)
from backend.db.models import AIThread, Module, TelemetrySample, TestRun, TestStatus


# ---------------------------------------------------------------------------
# Fixtures — seed a fake module + telemetry run.
# ---------------------------------------------------------------------------
@pytest.fixture()
def seeded(db_session: Session) -> Tuple[int, int]:
    """Returns (test_run_id, module_id_fk) for a passing thermal-cycling run."""
    mod = Module(serial_no="MOD-TEST-001", manufacturer="Acme", pmax_w=320.0)
    db_session.add(mod)
    db_session.commit()
    db_session.refresh(mod)

    run = TestRun(
        test_type="tc",
        standard="IEC 61215-2 MQT 11",
        mqt="MQT11",
        status=TestStatus.PASSED,
        module_id=mod.id,
        started_at=datetime(2026, 5, 1, 9, 0, 0),
        ended_at=datetime(2026, 5, 1, 11, 0, 0),
        sample_count=10,
        params={"cycles": 200, "t_min": -40, "t_max": 85},
        result={"pre_pmax_w": 320.0, "post_pmax_w": 318.5, "delta_pmax_pct": -0.47, "pass": True},
    )
    db_session.add(run)
    db_session.commit()
    db_session.refresh(run)

    # 10 telemetry samples decaying from 320 W to 318 W (≈ -0.6%).
    base = datetime(2026, 5, 1, 9, 0, 0)
    for i in range(10):
        db_session.add(TelemetrySample(
            test_run_id=run.id,
            ts=base + timedelta(seconds=i),
            step_no=1,
            voltage=48.0 + i * 0.01,
            current=6.65,
            power=320.0 - i * 0.22,  # 320 -> 318.02
            temperature=25.0 + i,
        ))
    db_session.commit()
    return run.id, mod.id


# ---------------------------------------------------------------------------
# Thread storage
# ---------------------------------------------------------------------------
def test_thread_keyed_by_module_id_with_title_prefix(db_session: Session) -> None:
    t = get_or_create_thread(db_session, "MOD-A")
    assert t.title == f"{THREAD_TITLE_PREFIX}MOD-A"
    assert _ensure_messages_list(t) == []

    # Second lookup must hit the same row, not create a new one.
    t2 = get_or_create_thread(db_session, "MOD-A")
    assert t2.id == t.id


def test_append_and_replay_preserves_order(db_session: Session) -> None:
    t = get_or_create_thread(db_session, "MOD-A")
    append_messages(db_session, t, [
        {"role": "user", "content": "hello", "ts": 1.0},
        {"role": "assistant", "content": "hi", "ts": 2.0},
    ])
    t2 = get_or_create_thread(db_session, "MOD-A")
    msgs = _ensure_messages_list(t2)
    assert [m["content"] for m in msgs] == ["hello", "hi"]


def test_modules_have_isolated_threads(db_session: Session) -> None:
    a = get_or_create_thread(db_session, "MOD-A")
    b = get_or_create_thread(db_session, "MOD-B")
    assert a.id != b.id

    append_messages(db_session, a, [{"role": "user", "content": "secret-a", "ts": 1.0}])
    append_messages(db_session, b, [{"role": "user", "content": "secret-b", "ts": 1.0}])

    msgs_a = _ensure_messages_list(get_or_create_thread(db_session, "MOD-A"))
    msgs_b = _ensure_messages_list(get_or_create_thread(db_session, "MOD-B"))
    assert msgs_a == [{"role": "user", "content": "secret-a", "ts": 1.0}]
    assert msgs_b == [{"role": "user", "content": "secret-b", "ts": 1.0}]


def test_legacy_messages_shape_is_normalised(db_session: Session) -> None:
    # Some legacy rows stored {"m": [...]} (see test_db_models.py).
    legacy = AIThread(title="module:LEGACY", messages={"m": [{"role": "user", "content": "old"}]})
    db_session.add(legacy)
    db_session.commit()
    db_session.refresh(legacy)
    assert _ensure_messages_list(legacy) == [{"role": "user", "content": "old"}]


def test_clear_thread_returns_false_when_missing(db_session: Session) -> None:
    assert clear_thread(db_session, "MOD-DOES-NOT-EXIST") is False


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------
def test_get_run_by_id(db_session: Session, seeded: Tuple[int, int]) -> None:
    run_id, _ = seeded
    out = tool_get_run(db_session, test_run_id=run_id)
    assert out["found"] is True
    assert out["run"]["id"] == run_id
    assert out["run"]["test_type"] == "tc"
    assert out["run"]["sample_count"] == 10


def test_get_run_by_module_serial(db_session: Session, seeded: Tuple[int, int]) -> None:
    run_id, _ = seeded
    out = tool_get_run(db_session, module_id="MOD-TEST-001")
    assert out["found"] is True
    assert out["runs"][0]["id"] == run_id


def test_get_run_unknown_returns_not_found(db_session: Session) -> None:
    out = tool_get_run(db_session, test_run_id=9999)
    assert out["found"] is False


def test_query_telemetry_returns_chronological_window(db_session: Session, seeded: Tuple[int, int]) -> None:
    run_id, _ = seeded
    out = tool_query_telemetry(db_session, test_run_id=run_id, last_n=5)
    assert out["count"] == 5
    ts_list = [s["ts"] for s in out["samples"]]
    assert ts_list == sorted(ts_list), "samples must be returned chronologically"


def test_query_telemetry_caps_last_n(db_session: Session, seeded: Tuple[int, int]) -> None:
    run_id, _ = seeded
    out = tool_query_telemetry(db_session, test_run_id=run_id, last_n=99999)
    assert out["count"] <= 1000


def test_recompute_analysis_from_telemetry(db_session: Session, seeded: Tuple[int, int]) -> None:
    run_id, _ = seeded
    out = tool_recompute_analysis(db_session, test_run_id=run_id)
    assert out["source"] == "telemetry"
    # 320 -> 318.02 ≈ -0.619%; well above the -5% Gate-2 floor.
    assert out["delta_pmax_pct"] < 0
    assert out["delta_pmax_pct"] > GATE2_PMAX_DELTA_PERCENT
    assert out["pass"] is True
    assert out["gate2_threshold_pct"] == GATE2_PMAX_DELTA_PERCENT


def test_recompute_analysis_falls_back_to_stored_result(db_session: Session) -> None:
    run = TestRun(
        test_type="hf", status=TestStatus.FAILED,
        result={"delta_pmax_pct": -7.2, "pass": False},
    )
    db_session.add(run)
    db_session.commit()
    db_session.refresh(run)
    out = tool_recompute_analysis(db_session, test_run_id=run.id)
    assert out["source"] == "stored_result"
    assert out["delta_pmax_pct"] == -7.2
    assert out["pass"] is False


def test_suggest_pass_fail_pass(db_session: Session, seeded: Tuple[int, int]) -> None:
    run_id, _ = seeded
    out = tool_suggest_pass_fail(db_session, test_run_id=run_id)
    assert out["recommendation"] == "PASS"
    assert 0.0 <= out["confidence"] <= 1.0
    assert "ΔPmax" in out["reason"]


def test_suggest_pass_fail_fail_when_below_gate(db_session: Session) -> None:
    run = TestRun(
        test_type="tc", status=TestStatus.FAILED,
        result={"delta_pmax_pct": -8.0, "pass": False},
    )
    db_session.add(run)
    db_session.commit()
    db_session.refresh(run)
    out = tool_suggest_pass_fail(db_session, test_run_id=run.id)
    assert out["recommendation"] == "FAIL"
    assert out["confidence"] > 0


# ---------------------------------------------------------------------------
# Intent router
# ---------------------------------------------------------------------------
def test_plan_extracts_run_id_from_natural_language() -> None:
    plan = plan_tool_calls(
        "what was the verdict for TR-42?", default_run_id=None, module_id="MOD-A"
    )
    names = [c["name"] for c in plan]
    assert "suggest_pass_fail" in names
    # The TR-42 mention should have been parsed out and threaded through.
    verdict = next(c for c in plan if c["name"] == "suggest_pass_fail")
    assert verdict["args"]["test_run_id"] == 42


def test_plan_telemetry_last_n_parsed() -> None:
    plan = plan_tool_calls(
        "show me the last 50 telemetry samples", default_run_id=7, module_id="MOD-A"
    )
    tel = next(c for c in plan if c["name"] == "query_telemetry")
    assert tel["args"]["last_n"] == 50
    assert tel["args"]["test_run_id"] == 7


def test_plan_defaults_to_get_run_for_chitchat() -> None:
    plan = plan_tool_calls("hello", default_run_id=None, module_id="MOD-A")
    assert plan and plan[0]["name"] == "get_run"
    assert plan[0]["args"]["module_id"] == "MOD-A"


def test_plan_skips_run_specific_tools_when_no_run_id() -> None:
    plan = plan_tool_calls(
        "what's the verdict?", default_run_id=None, module_id="MOD-A"
    )
    # No run id -> verdict tool can't run; only get_run is emitted.
    names = [c["name"] for c in plan]
    assert "suggest_pass_fail" not in names
    assert "get_run" in names


# ---------------------------------------------------------------------------
# SSE streaming via TestClient
# ---------------------------------------------------------------------------
@pytest.fixture()
def client(isolated_db_url) -> Iterator[Tuple[TestClient, int, int]]:
    """Spin up the FastAPI app against an isolated SQLite file + seed data."""
    from backend.db.models import Module, TelemetrySample, TestRun, TestStatus
    from backend.db.session import get_session, init_db

    init_db()
    with get_session() as s:
        mod = Module(serial_no="MOD-TEST-001", pmax_w=320.0)
        s.add(mod)
        s.commit()
        s.refresh(mod)
        run = TestRun(
            test_type="tc",
            standard="IEC 61215-2 MQT 11",
            status=TestStatus.PASSED,
            module_id=mod.id,
            started_at=datetime(2026, 5, 1, 9, 0, 0),
            sample_count=10,
            result={"pre_pmax_w": 320.0, "post_pmax_w": 318.5, "delta_pmax_pct": -0.47, "pass": True},
        )
        s.add(run)
        s.commit()
        s.refresh(run)
        base = datetime(2026, 5, 1, 9, 0, 0)
        for i in range(10):
            s.add(TelemetrySample(
                test_run_id=run.id,
                ts=base + timedelta(seconds=i),
                power=320.0 - i * 0.22,
                voltage=48.0, current=6.65, temperature=25.0,
            ))
        s.commit()
        run_id = run.id
        mod_id = mod.id

    from backend.main import app

    with TestClient(app) as c:
        yield c, run_id, mod_id


def _parse_sse(blob: str) -> List[Tuple[str, dict]]:
    """Parse SSE text into [(event_name, json_data), ...].

    Comment lines (':...') and blank separators are stripped. Multi-line
    ``data:`` fields are re-joined with newlines before JSON decode.
    """
    events: List[Tuple[str, dict]] = []
    current_event: str | None = None
    data_buf: List[str] = []
    for line in blob.splitlines():
        if line.startswith(":"):
            continue
        if line == "":
            if current_event is not None:
                payload = "\n".join(data_buf) or "{}"
                try:
                    events.append((current_event, json.loads(payload)))
                except json.JSONDecodeError:
                    events.append((current_event, {"_raw": payload}))
            current_event, data_buf = None, []
            continue
        if line.startswith("event:"):
            current_event = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            data_buf.append(line.split(":", 1)[1].lstrip())
    return events


def test_get_thread_creates_empty_thread(client) -> None:
    c, _, _ = client
    r = c.get("/api/assistant/threads/MOD-NEW")
    assert r.status_code == 200
    body = r.json()
    assert body["module_id"] == "MOD-NEW"
    assert body["messages"] == []
    assert body["thread_id"] > 0


def test_post_message_streams_meta_tools_tokens_done(client) -> None:
    c, run_id, _ = client
    r = c.post(
        f"/api/assistant/threads/MOD-TEST-001/messages",
        json={
            "message": f"What's the verdict for TR-{run_id}?",
            "test_run_id": run_id,
        },
    )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    events = _parse_sse(r.text)
    names = [e[0] for e in events]
    assert names[0] == "meta", f"first event should be meta, got {names}"
    assert "tool_call" in names
    assert "tool_result" in names
    assert "token" in names
    assert names[-1] == "done"

    # The suggest_pass_fail tool result should ride through.
    verdict_evt = next(
        (data for name, data in events if name == "tool_result" and data.get("name") == "suggest_pass_fail"),
        None,
    )
    assert verdict_evt is not None
    assert verdict_evt["result"]["recommendation"] in {"PASS", "FAIL"}


def test_post_message_persists_to_thread(client) -> None:
    c, run_id, _ = client
    c.post(
        "/api/assistant/threads/MOD-TEST-001/messages",
        json={"message": "tell me about this module", "test_run_id": run_id},
    )
    r = c.get("/api/assistant/threads/MOD-TEST-001")
    body = r.json()
    roles = [m["role"] for m in body["messages"]]
    assert roles == ["user", "assistant"], f"expected one round-trip, got {roles}"


def test_threads_remain_isolated_across_modules(client) -> None:
    c, run_id, _ = client
    c.post(
        "/api/assistant/threads/MOD-A/messages",
        json={"message": "context for A only", "test_run_id": run_id},
    )
    c.post(
        "/api/assistant/threads/MOD-B/messages",
        json={"message": "context for B only", "test_run_id": run_id},
    )
    a_msgs = c.get("/api/assistant/threads/MOD-A").json()["messages"]
    b_msgs = c.get("/api/assistant/threads/MOD-B").json()["messages"]
    assert any("context for A only" in m["content"] for m in a_msgs)
    assert all("context for A only" not in m["content"] for m in b_msgs)


def test_delete_thread_clears_history(client) -> None:
    c, run_id, _ = client
    c.post(
        "/api/assistant/threads/MOD-Z/messages",
        json={"message": "hi", "test_run_id": run_id},
    )
    r = c.delete("/api/assistant/threads/MOD-Z")
    assert r.status_code == 204
    body = c.get("/api/assistant/threads/MOD-Z").json()
    assert body["messages"] == []


def test_tools_endpoint_advertises_four_tools(client) -> None:
    c, _, _ = client
    r = c.get("/api/assistant/tools")
    assert r.status_code == 200
    body = r.json()
    names = {t["name"] for t in body["tools"]}
    assert names == {"get_run", "query_telemetry", "recompute_analysis", "suggest_pass_fail"}
    assert body["gate2_threshold_pct"] == GATE2_PMAX_DELTA_PERCENT


def test_invalid_module_id_rejected(client) -> None:
    c, _, _ = client
    # Whitespace-only after stripping -> 400. FastAPI's path validator allows
    # whitespace through (min_length=1 passes), so the assistant's own
    # normaliser raises.
    r = c.get("/api/assistant/threads/%20%20")
    assert r.status_code == 400
