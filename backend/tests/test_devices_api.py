"""REST API tests for the device router."""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.main import app  # noqa: E402


client = TestClient(app)


def test_list_devices_returns_registry() -> None:
    r = client.get("/api/devices")
    assert r.status_code == 200
    j = r.json()
    assert j["count"] >= 1
    ids = {d["id"] for d in j["devices"]}
    assert "itech_pv6000" in ids


def test_get_single_device() -> None:
    r = client.get("/api/devices/itech_pv6000")
    assert r.status_code == 200
    d = r.json()
    assert d["transport"]["kind"] == "scpi_tcp"
    assert d["transport"]["port"] == 30000


def test_get_missing_device_404() -> None:
    r = client.get("/api/devices/no_such_device")
    assert r.status_code == 404


def test_set_mode_toggle() -> None:
    r = client.post("/api/devices/itech_pv6000/mode", json={"mode": "live"})
    assert r.status_code == 200
    assert r.json()["demo"] is False
    r = client.post("/api/devices/itech_pv6000/mode", json={"mode": "demo"})
    assert r.status_code == 200
    assert r.json()["demo"] is True


def test_set_mode_invalid_rejected() -> None:
    r = client.post("/api/devices/itech_pv6000/mode", json={"mode": "wat"})
    assert r.status_code == 400


def test_audit_tail_endpoint() -> None:
    # Issue a ping to seed an audit entry, then read the tail.
    client.post("/api/devices/itech_pv6000/ping")
    r = client.get("/api/devices/audit/tail?n=10")
    assert r.status_code == 200
    j = r.json()
    assert "entries" in j
