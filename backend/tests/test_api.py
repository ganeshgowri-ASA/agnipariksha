"""Endpoint coverage for the FastAPI backend."""
from __future__ import annotations

import json
import time


# --- health / device --------------------------------------------------------

def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["demo"] is True


def test_device_status(client):
    r = client.get("/api/device/status")
    assert r.status_code == 200
    body = r.json()
    assert "connected" in body
    assert body["demo"] is True
    assert body["running_tests"] == []


def test_device_connect_demo(client):
    r = client.post("/api/device/connect", json={})
    assert r.status_code == 200
    body = r.json()
    assert body["connected"] is True
    assert body["demo"] is True


def test_device_estop_latency(client):
    # Warm the path once to avoid first-call import jitter.
    client.post("/api/device/estop")

    t0 = time.perf_counter()
    r = client.post("/api/device/estop")
    wall_ms = (time.perf_counter() - t0) * 1000.0
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    # The spec requires the SCPI-level call < 50ms; we report it explicitly.
    assert body["latency_ms"] < 50.0
    # Sanity: overall HTTP round-trip in-process should also be well under 200ms.
    assert wall_ms < 200.0


# --- test lifecycle ---------------------------------------------------------

def test_start_and_stop_test(client):
    r = client.post(
        "/api/tests/tc/start",
        json={"module_id": "M-001", "params": {"isc": 10.0, "imp": 9.2}},
    )
    assert r.status_code == 200
    session_id = r.json()["session_id"]
    assert session_id

    # Duplicate start is rejected.
    r2 = client.post("/api/tests/tc/start", json={})
    assert r2.status_code == 409

    # Latest results endpoint returns the freshly created session.
    r3 = client.get("/api/tests/tc/results")
    assert r3.status_code == 200
    assert r3.json()["session"]["id"] == session_id

    # Stop the test; verdict is computed from (likely empty) measurements.
    r4 = client.post("/api/tests/tc/stop")
    assert r4.status_code == 200
    body = r4.json()
    assert body["session_id"] == session_id
    assert body["status"] in {"passed", "failed", "stopped"}
    assert "verdict" in body["result"]


def test_unknown_test_id(client):
    r = client.post("/api/tests/bogus/start", json={})
    assert r.status_code == 400


def test_stop_without_start(client):
    r = client.post("/api/tests/hf/stop")
    assert r.status_code == 404


# --- sessions ---------------------------------------------------------------

def test_sessions_list_and_detail(client):
    # Create two sessions across two test ids.
    s1 = client.post("/api/tests/bdt/start", json={}).json()["session_id"]
    client.post("/api/tests/bdt/stop")
    s2 = client.post("/api/tests/gct/start", json={}).json()["session_id"]
    client.post("/api/tests/gct/stop")

    r = client.get("/api/sessions")
    assert r.status_code == 200
    body = r.json()
    assert body["count"] >= 2
    ids = {item["id"] for item in body["items"]}
    assert {s1, s2}.issubset(ids)

    r2 = client.get(f"/api/sessions/{s1}")
    assert r2.status_code == 200
    assert r2.json()["id"] == s1

    # Filter by test_id.
    r3 = client.get("/api/sessions", params={"test_id": "gct"})
    assert r3.status_code == 200
    assert all(item["test_id"] == "gct" for item in r3.json()["items"])


def test_session_not_found(client):
    r = client.get("/api/sessions/does-not-exist")
    assert r.status_code == 404


# --- reports ---------------------------------------------------------------

def _seed_session_with_data(client) -> str:
    """Create a session and push synthetic measurements directly into DB."""
    from db import session_scope, insert_measurement, finalize_session
    from demo import get_generator

    s_id = client.post(
        "/api/tests/letid/start",
        json={"module_id": "M-RPT", "params": {"isc": 10.0, "imp": 9.2}},
    ).json()["session_id"]

    gen = get_generator("letid")
    with session_scope() as db:
        for k in range(30):
            r = gen(float(k), {"isc": 10.0, "imp": 9.2})
            insert_measurement(db, session_id=s_id, v=r.v, i=r.i, p=r.p, step=r.step, extra=r.extra)

    client.post("/api/tests/letid/stop")
    return s_id


def test_report_word(client):
    s_id = _seed_session_with_data(client)
    r = client.get(f"/api/reports/{s_id}/word")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    # docx is a zip — magic bytes PK\x03\x04
    assert r.content[:2] == b"PK"


def test_report_pdf(client):
    s_id = _seed_session_with_data(client)
    r = client.get(f"/api/reports/{s_id}/pdf")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/pdf")
    assert r.content[:4] == b"%PDF"


def test_report_missing_session(client):
    r = client.get("/api/reports/nope/pdf")
    assert r.status_code == 404


# --- websocket --------------------------------------------------------------

def test_websocket_live_idle_then_running(client):
    with client.websocket_connect("/ws/live") as ws:
        # Idle frame first.
        msg = json.loads(ws.receive_text())
        assert msg["test_id"] is None
        assert msg["extra"]["idle"] is True

        # Start a test and observe a non-idle frame.
        sid = client.post("/api/tests/rco/start", json={"params": {"fuse_rating": 15}}).json()["session_id"]

        # Drain a few frames; expect to see our running test within a short window.
        seen_running = False
        for _ in range(30):
            msg = json.loads(ws.receive_text())
            if msg["test_id"] == "rco":
                assert msg["session_id"] == sid
                assert msg["v"] is not None and msg["i"] is not None
                seen_running = True
                break
        assert seen_running, "WS never reported the running test"

        client.post("/api/tests/rco/stop")
