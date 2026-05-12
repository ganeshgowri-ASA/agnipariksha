"""Integration tests for the FastAPI health endpoints."""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.main import app  # noqa: E402


def test_legacy_health() -> None:
    with TestClient(app) as c:
        r = c.get("/health")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ok"
        assert "version" in body
        assert "demo" in body


def test_deep_health_shape() -> None:
    with TestClient(app) as c:
        r = c.get("/api/health")
        assert r.status_code == 200
        body = r.json()
        for k in ("status", "demo", "version", "scpi_reachable",
                  "scpi_target", "disk_free_mb", "uptime_s"):
            assert k in body, f"missing {k}"
        assert isinstance(body["scpi_reachable"], bool)
        assert isinstance(body["uptime_s"], int)


def test_test_control_accepts_valid_action() -> None:
    with TestClient(app) as c:
        r = c.post("/api/tests/demo-1/control", json={"action": "start"})
        assert r.status_code == 200
        assert r.json()["accepted"] is True


def test_test_control_rejects_invalid_action() -> None:
    with TestClient(app) as c:
        r = c.post("/api/tests/demo-1/control", json={"action": "yeet"})
        assert r.status_code == 200
        assert r.json()["accepted"] is False
