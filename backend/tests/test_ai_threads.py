"""Thread persistence + SSE streaming tests."""
from __future__ import annotations

import json

from fastapi.testclient import TestClient

from backend.main import app


def _client():
    return TestClient(app)


def _make_module(c) -> str:
    r = c.post("/api/modules", json={
        "manufacturer": "Sun-Earth",
        "model": "SE-540BG",
        "technology": "TOPCon",
        "pmax_stc": 540, "voc": 50.2, "isc": 13.8, "vmpp": 41.9, "impp": 12.88,
        "bypass_diode_part": "PV-40SHK4",
    })
    assert r.status_code == 201, r.text
    return r.json()["module_id"]


def _make_run(c, module_id: str) -> str:
    r = c.post("/api/runs", json={
        "module_id": module_id,
        "test_type": "bdt",
        "iec_clause": "MQT18",
        "params": {"vf_slope_mV_per_C": -2.0, "tj_max_c": 128.0},
    })
    assert r.status_code == 201, r.text
    run_id = r.json()["run_id"]
    # Push telemetry implying Tj ≈ 125 °C (Vf 0.55 → 0.45 at +75 °C).
    rt = c.post(f"/api/runs/{run_id}/telemetry", json={
        "samples": [
            {"t": 0,  "voltage": 0.55, "current": 13.8, "power": 7.6, "temperature": 75},
            {"t": 30, "voltage": 0.50, "current": 13.8, "power": 6.9, "temperature": 90},
            {"t": 60, "voltage": 0.45, "current": 13.8, "power": 6.2, "temperature": 95},
        ],
    })
    assert rt.status_code == 200, rt.text
    return run_id


def test_thread_create_and_fetch_round_trip(temp_db) -> None:
    with _client() as c:
        module_id = _make_module(c)
        tr = c.post("/api/ai/threads", json={
            "module_id": module_id,
            "tab_context": "bdt",
            "title": "Bypass diode questions",
        })
        assert tr.status_code == 201, tr.text
        thread_id = tr.json()["thread_id"]

        listr = c.get("/api/ai/threads", params={"module_id": module_id})
        assert listr.status_code == 200
        assert any(t["thread_id"] == thread_id for t in listr.json())

        getr = c.get(f"/api/ai/threads/{thread_id}")
        body = getr.json()
        assert body["title"] == "Bypass diode questions"
        assert body["module_id"] == module_id
        assert body["messages"] == []


def test_thread_patch_changes_run_and_tab(temp_db) -> None:
    with _client() as c:
        module_id = _make_module(c)
        run_id = _make_run(c, module_id)
        thread_id = c.post("/api/ai/threads", json={"module_id": module_id, "tab_context": "bdt"}).json()["thread_id"]

        pr = c.patch(f"/api/ai/threads/{thread_id}", json={"run_id": run_id, "tab_context": "analysis"})
        assert pr.status_code == 200
        body = pr.json()
        assert body["run_id"] == run_id
        assert body["tab_context"] == "analysis"


def test_ask_sse_persists_user_and_assistant_messages(temp_db, monkeypatch) -> None:
    # Force the fallback (no LLM key) path so this test is hermetic.
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with _client() as c:
        module_id = _make_module(c)
        run_id = _make_run(c, module_id)
        thread_id = c.post("/api/ai/threads", json={
            "module_id": module_id,
            "tab_context": "bdt",
            "run_id": run_id,
        }).json()["thread_id"]

        with c.stream(
            "POST",
            "/api/ai/ask",
            json={
                "thread_id": thread_id,
                "message": "What is the calculated Tj for this run and is it within datasheet limits?",
                "tab_context": "bdt",
                "module_id": module_id,
                "run_id": run_id,
            },
        ) as resp:
            assert resp.status_code == 200, resp.read()
            assert resp.headers["content-type"].startswith("text/event-stream")
            payload = b"".join(chunk for chunk in resp.iter_bytes()).decode()

        # SSE must contain at least one delta and a done event.
        assert "event: delta" in payload
        assert "event: done" in payload
        # The fallback grounds itself in tools — so we expect a tool_call event.
        assert "event: tool_call" in payload
        # Tj-related content (case-insensitive).
        assert "tj" in payload.lower()
        assert "PV-40SHK4" in payload or "bypass" in payload.lower()
        # Citation event for MQT18 (or its title) should be present.
        assert "MQT18" in payload

        # After the SSE call completes, the assistant message is persisted.
        getr = c.get(f"/api/ai/threads/{thread_id}")
        msgs = getr.json()["messages"]
        roles = [m["role"] for m in msgs]
        assert roles == ["user", "assistant"]
        assert "Tj" in msgs[1]["content"] or "tj" in msgs[1]["content"].lower()
        assert any(c["clause_id"] == "MQT18" for c in msgs[1]["citations"])
        # Title should have been auto-derived from the first user prompt.
        assert getr.json()["title"].startswith("What is the calculated Tj")


def test_thread_isolation_per_module(temp_db) -> None:
    with _client() as c:
        m1 = _make_module(c)
        m2_payload = {**c.get(f"/api/modules/{m1}").json()}
        m2_payload["model"] = "SE-540BG-v2"
        # Strip read-only fields.
        for k in ("module_id", "created_at"):
            m2_payload.pop(k, None)
        m2 = c.post("/api/modules", json=m2_payload).json()["module_id"]

        c.post("/api/ai/threads", json={"module_id": m1, "tab_context": "tc"})
        c.post("/api/ai/threads", json={"module_id": m2, "tab_context": "bdt"})

        only_m1 = c.get("/api/ai/threads", params={"module_id": m1}).json()
        only_m2 = c.get("/api/ai/threads", params={"module_id": m2}).json()
        assert len(only_m1) == 1
        assert len(only_m2) == 1
        assert only_m1[0]["module_id"] == m1
        assert only_m2[0]["module_id"] == m2
