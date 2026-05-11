"""Shared pytest fixtures for backend API tests.

Each test gets a fresh on-disk SQLite DB and a clean orchestrator stub.
We point AGNI_DB_URL at a temp file *before* importing the app so the
SQLAlchemy engine binds to the right DB.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import pytest

# Backend package is at repo/backend; tests run from there.
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db_file = tmp_path / "test_agni.db"
    monkeypatch.setenv("AGNI_DB_URL", f"sqlite:///{db_file}")
    monkeypatch.setenv("AGNI_REPORTS_DIR", str(tmp_path / "reports"))
    monkeypatch.setenv("DEMO_MODE", "true")

    # Force re-import so the module-level engine binds to the temp DB.
    for mod in ("db", "main", "reports", "scpi_stub", "orchestrator_stub", "demo"):
        sys.modules.pop(mod, None)

    from fastapi.testclient import TestClient  # imported after env is set
    import main  # noqa: F401  ensures app is built

    with TestClient(main.app) as c:
        yield c
