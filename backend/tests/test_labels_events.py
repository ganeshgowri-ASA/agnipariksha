"""Tests for V2-S7 additions: QR labels, /ws/events, auth gating."""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.main import app  # noqa: E402


def test_module_label_pdf() -> None:
    with TestClient(app) as c:
        r = c.get("/modules/abc-123/label")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("application/pdf")
        assert r.content[:4] == b"%PDF"


def test_equipment_label_pdf() -> None:
    with TestClient(app) as c:
        r = c.get("/equipment/XYZ-7/label")
        assert r.status_code == 200
        assert r.content[:4] == b"%PDF"


def test_events_ws_hello_and_alarm_roundtrip() -> None:
    with TestClient(app) as c:
        with c.websocket_connect("/ws/events") as ws:
            hello = ws.receive_json()
            assert hello["type"] == "hello"
            # Push an alarm via REST → should appear on the WS.
            r = c.post(
                "/api/events/alarm",
                json={"severity": "warn", "message": "temp drift"},
            )
            assert r.status_code == 200
            evt = ws.receive_json()
            assert evt["type"] == "alarm"
            assert evt["data"]["message"] == "temp drift"


def test_dev_token_when_auth_disabled() -> None:
    with TestClient(app) as c:
        r = c.get("/api/auth/dev-token")
        assert r.status_code == 200
        body = r.json()
        assert body["auth_enabled"] is False


def test_vapid_public_key_endpoint() -> None:
    with TestClient(app) as c:
        r = c.get("/api/push/vapid-public-key")
        assert r.status_code == 200
        assert "key" in r.json()
