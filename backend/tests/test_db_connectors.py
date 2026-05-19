"""Tests for the DB connector layer."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.database.connectors import (  # noqa: E402
    backend_for,
    decrypt_url,
    encrypt_url,
    list_backends,
    test_connection as probe_connection,
)
from backend.app.database.store import load_settings, save_settings  # noqa: E402
from backend.main import app  # noqa: E402


# --- redirect at-rest data to tmp so tests don't poke at the real keyring ---
@pytest.fixture()
def isolated_store(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "data").mkdir(parents=True, exist_ok=True)
    yield tmp_path


# --- backends ---------------------------------------------------------------
def test_list_backends_includes_required_schemes() -> None:
    schemes = {b["key"] for b in list_backends()}
    assert {"sqlite", "postgres", "mysql", "mssql", "access"} <= schemes


def test_backend_for_resolves_known_urls() -> None:
    assert backend_for("sqlite:///./x.db").key == "sqlite"
    assert backend_for("postgresql+psycopg://u:p@h/d").key == "postgres"
    assert backend_for("mysql+pymysql://u:p@h/d").key == "mysql"
    assert backend_for("mssql+pyodbc://u:p@h/d").key == "mssql"
    assert backend_for("https://nope") is None


# --- test_connection --------------------------------------------------------
def test_probe_connection_returns_latency_and_version_for_sqlite(isolated_store) -> None:
    result = probe_connection("sqlite:///./data/probe.db")
    assert result["ok"] is True
    assert result["backend"] == "sqlite"
    assert isinstance(result["latency_ms"], int) and result["latency_ms"] >= 0
    assert result["server_version"] is not None  # SQLite reports its version


def test_probe_connection_surfaces_error_on_bad_url(isolated_store) -> None:
    # Missing driver — psycopg isn't installed in this hermetic env.
    result = probe_connection("postgresql+psycopg://nope:nope@127.0.0.1:1/agni")
    assert result["ok"] is False
    assert result["error"]
    assert result["backend"] == "postgres"


# --- Fernet round-trip ------------------------------------------------------
def test_encrypt_decrypt_round_trip(isolated_store) -> None:
    plain = "postgresql+psycopg://user:secret@db.internal:5432/agnipariksha"
    token = encrypt_url(plain)
    assert token != plain
    assert decrypt_url(token) == plain


# --- store ------------------------------------------------------------------
def test_settings_round_trip_persists_encrypted_url(isolated_store) -> None:
    plain = "sqlite:///./data/foo.db"
    s = save_settings(backend="sqlite", label="primary", plain_url=plain)
    assert s.encrypted_url
    assert plain not in s.encrypted_url  # never persisted in plain
    loaded = load_settings()
    assert loaded.backend == "sqlite"
    assert loaded.label == "primary"
    assert loaded.url() == plain


# --- API surface ------------------------------------------------------------
def test_get_current_returns_redacted_preview(isolated_store) -> None:
    with TestClient(app) as c:
        r = c.get("/api/settings/database")
        assert r.status_code == 200
        body = r.json()
        assert body["backend"]
        assert "supported" in body
        assert any(b["key"] == "sqlite" for b in body["supported"])
        # url_preview never carries a password.
        assert ":***@" in body["url_preview"] or body["url_preview"].startswith("sqlite")


def test_post_test_endpoint_redacts_password(isolated_store) -> None:
    with TestClient(app) as c:
        r = c.post(
            "/api/settings/database/test",
            json={"url": "postgresql+psycopg://u:supersecret@127.0.0.1:1/agni"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is False
        assert "supersecret" not in body["url_preview"]
        assert ":***@" in body["url_preview"]


def test_post_save_rejects_url_that_fails_test(isolated_store) -> None:
    with TestClient(app) as c:
        r = c.post(
            "/api/settings/database/save",
            json={
                "backend": "postgres",
                "label": "bad",
                "url": "postgresql+psycopg://u:pw@127.0.0.1:1/none",
            },
        )
        assert r.status_code == 400
        body = r.json()
        assert body["detail"]["error"] == "test_failed"


def test_post_save_accepts_skip_test_for_offline_drivers(isolated_store) -> None:
    with TestClient(app) as c:
        r = c.post(
            "/api/settings/database/save",
            json={
                "backend": "sqlite",
                "label": "offline",
                "url": "sqlite:///./data/saved.db",
                "skip_test": True,
            },
        )
        assert r.status_code == 200
        assert r.json()["ok"] is True


def test_switch_dry_run_does_not_mutate(isolated_store) -> None:
    with TestClient(app) as c:
        r = c.post(
            "/api/settings/database/switch",
            json={
                "url": "sqlite:///./data/target.db",
                "label": "dry",
                "backend": "sqlite",
                "dry_run": True,
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert body["error"] == "dry_run — no migration applied"
