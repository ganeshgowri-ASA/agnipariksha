"""REST API tests for the PV module catalogue router."""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.modules_api import get_store  # noqa: E402
from backend.main import app  # noqa: E402


client = TestClient(app)


def setup_function() -> None:
    # Each test starts from the bundled seed catalogue so registrations
    # added by earlier cases don't leak.
    get_store().reset()


def test_list_modules_returns_seed_catalogue() -> None:
    r = client.get("/api/modules")
    assert r.status_code == 200
    items = r.json()
    ids = {m["id"] for m in items}
    assert {"MOD-2026-001", "MOD-2026-002", "MOD-2026-003"}.issubset(ids)


def test_get_known_module_returns_nameplate() -> None:
    r = client.get("/api/modules/MOD-2026-001")
    assert r.status_code == 200
    m = r.json()
    assert m["id"] == "MOD-2026-001"
    assert m["manufacturer"] == "Vikram Solar"
    assert m["pmax_w"] == 540.0
    assert m["isc_a"] == 13.85


def test_get_unknown_module_returns_404() -> None:
    r = client.get("/api/modules/DOES-NOT-EXIST")
    assert r.status_code == 404
    assert "not found" in r.json()["detail"].lower()


def test_get_module_id_is_trimmed() -> None:
    # Browsers may send trailing whitespace from clipboard pastes; the
    # endpoint should still resolve a clean ID.
    r = client.get("/api/modules/MOD-2026-002 ")
    # NOTE: FastAPI URL-encodes the trailing space, so the path param
    # arrives as "MOD-2026-002 ". The store trims it before lookup.
    assert r.status_code == 200
    assert r.json()["id"] == "MOD-2026-002"


def test_register_module_then_lookup_roundtrip() -> None:
    payload = {
        "id": "MOD-2026-999",
        "model": "Test Module",
        "manufacturer": "Agni Labs",
        "pmax_w": 600.0,
        "voc_v": 50.1,
        "isc_a": 15.0,
        "vmpp_v": 42.0,
        "impp_a": 14.3,
    }
    r = client.post("/api/modules", json=payload)
    assert r.status_code == 201

    follow = client.get("/api/modules/MOD-2026-999")
    assert follow.status_code == 200
    assert follow.json()["manufacturer"] == "Agni Labs"
