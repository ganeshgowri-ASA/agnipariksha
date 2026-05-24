"""Tests for the BDT MQT 18.1 recipe stub endpoint."""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.main import app  # noqa: E402


def test_mqt18_recipe_stub_returns_501() -> None:
    with TestClient(app) as c:
        r = c.post(
            "/api/bdt/mqt18-1/recipes",
            json={"nameplate": {"manufacturer": "Acme"}, "diodes": []},
        )
        assert r.status_code == 501
        body = r.json()
        assert body["code"] == "not_implemented"


def test_mqt18_recipe_stub_accepts_empty_body() -> None:
    with TestClient(app) as c:
        r = c.post("/api/bdt/mqt18-1/recipes")
        assert r.status_code == 501
