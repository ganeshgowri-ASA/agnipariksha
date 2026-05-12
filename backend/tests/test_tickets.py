"""Tests for the unified ticketing API (V2-S5)."""
from __future__ import annotations

import base64
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.main import app  # noqa: E402
from backend.tickets import store  # noqa: E402


@pytest.fixture(autouse=True)
def _clean_store():
    store.reset()
    yield
    store.reset()


def _client() -> TestClient:
    return TestClient(app)


def test_create_maintenance_ticket() -> None:
    with _client() as c:
        r = c.post("/api/tickets", json={
            "type": "maintenance",
            "title": "Calibrate PV6000",
            "description": "Annual calibration overdue",
            "priority": "high",
            "links": {"equipment_id": "ITECH-PV6000"},
            "tags": ["calibration"],
            "source": "report_tab",
        })
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["id"].startswith("TKT-")
        assert body["type"] == "maintenance"
        assert body["state"] == "open"
        assert body["priority"] == "high"
        assert body["due_at"] > body["created_at"]
        assert body["sla_breached"] is False
        assert body["links"]["equipment_id"] == "ITECH-PV6000"


def test_create_complaint_from_error_toast() -> None:
    with _client() as c:
        r = c.post("/api/tickets", json={
            "type": "complaint",
            "title": "WebSocket dropped during TC run",
            "description": "Disconnected at 12:04 — readings stopped.",
            "priority": "normal",
            "source": "error_toast",
            "links": {"test_run_id": "TC-1234567890"},
        })
        assert r.status_code == 201
        body = r.json()
        assert body["type"] == "complaint"
        assert body["source"] == "error_toast"


def test_blank_title_rejected() -> None:
    with _client() as c:
        r = c.post("/api/tickets", json={"type": "maintenance", "title": "   "})
        assert r.status_code == 422


def test_list_and_filter() -> None:
    with _client() as c:
        c.post("/api/tickets", json={"type": "maintenance", "title": "A"})
        c.post("/api/tickets", json={"type": "complaint", "title": "B"})
        c.post("/api/tickets", json={"type": "complaint", "title": "C", "assignee": "alice"})

        r = c.get("/api/tickets")
        assert r.status_code == 200
        assert len(r.json()) == 3

        r = c.get("/api/tickets", params={"type": "complaint"})
        assert {t["title"] for t in r.json()} == {"B", "C"}

        r = c.get("/api/tickets", params={"assignee": "alice"})
        assert [t["title"] for t in r.json()] == ["C"]

        r = c.get("/api/tickets", params={"q": "b"})
        assert [t["title"] for t in r.json()] == ["B"]


def test_state_transitions() -> None:
    with _client() as c:
        tid = c.post("/api/tickets", json={"type": "maintenance", "title": "X"}).json()["id"]

        r = c.post(f"/api/tickets/{tid}/transition", json={"to": "in_progress"})
        assert r.status_code == 200
        assert r.json()["state"] == "in_progress"

        r = c.post(f"/api/tickets/{tid}/transition", json={"to": "waiting_part", "note": "Need fan"})
        assert r.json()["state"] == "waiting_part"

        r = c.post(f"/api/tickets/{tid}/transition", json={"to": "resolved"})
        assert r.json()["state"] == "resolved"

        r = c.post(f"/api/tickets/{tid}/transition", json={"to": "closed"})
        assert r.json()["state"] == "closed"

        history = r.json()["history"]
        assert any(h.get("event") == "transition" and h.get("to") == "closed" for h in history)


def test_invalid_transition_409() -> None:
    with _client() as c:
        tid = c.post("/api/tickets", json={"type": "maintenance", "title": "X"}).json()["id"]
        # open -> in_progress is fine; closed -> in_progress is not.
        c.post(f"/api/tickets/{tid}/transition", json={"to": "closed"})
        r = c.post(f"/api/tickets/{tid}/transition", json={"to": "in_progress"})
        assert r.status_code == 409


def test_patch_assignee_emits_notification() -> None:
    with _client() as c:
        tid = c.post("/api/tickets", json={"type": "complaint", "title": "Noise"}).json()["id"]
        r = c.patch(f"/api/tickets/{tid}", json={"assignee": "bob@example.com"})
        assert r.status_code == 200
        assert r.json()["assignee"] == "bob@example.com"

        notes = c.get("/api/tickets/_notifications").json()["items"]
        assert any(n["ticket_id"] == tid and n["assignee"] == "bob@example.com" for n in notes)
        ch = next(n["channels"] for n in notes if n["ticket_id"] == tid)
        assert "email" in ch and "webpush" in ch


def test_attachment_upload_and_size_limit() -> None:
    with _client() as c:
        tid = c.post("/api/tickets", json={"type": "maintenance", "title": "Z"}).json()["id"]

        good = base64.b64encode(b"hello world").decode()
        r = c.post(f"/api/tickets/{tid}/attachments", json={
            "name": "note.txt", "mime": "text/plain", "data_b64": good,
        })
        assert r.status_code == 201
        att = r.json()
        assert att["size"] == 11
        t = c.get(f"/api/tickets/{tid}").json()
        assert len(t["attachments"]) == 1

        # Path-traversal style name rejected.
        r = c.post(f"/api/tickets/{tid}/attachments", json={
            "name": "../evil", "mime": "text/plain", "data_b64": good,
        })
        assert r.status_code == 422


def test_priority_change_recomputes_due_at() -> None:
    with _client() as c:
        tid = c.post("/api/tickets", json={
            "type": "maintenance", "title": "P", "priority": "low",
        }).json()["id"]
        first_due = c.get(f"/api/tickets/{tid}").json()["due_at"]
        c.patch(f"/api/tickets/{tid}", json={"priority": "critical"})
        new_due = c.get(f"/api/tickets/{tid}").json()["due_at"]
        # critical SLA (4h) << low SLA (120h)
        assert new_due < first_due


def test_sla_breach_flag() -> None:
    """A ticket past its due_at and still open should report sla_breached."""
    # Create via store directly so we can backdate created_at.
    from backend.tickets import TicketCreate
    t = store.create(TicketCreate(type="complaint", title="Old"))
    t.created_at = time.time() - 10 * 24 * 3600  # 10 days ago
    t.due_at = t.created_at + 3600  # due 10 days ago
    with _client() as c:
        body = c.get(f"/api/tickets/{t.id}").json()
        assert body["sla_breached"] is True


def test_unknown_ticket_404() -> None:
    with _client() as c:
        assert c.get("/api/tickets/TKT-NOPE").status_code == 404
