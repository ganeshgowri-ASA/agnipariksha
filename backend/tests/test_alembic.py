"""Alembic plumbing tests.

Verifies that the initial migration applies cleanly to a scratch SQLite
file and that running it against an already-migrated DB is a no-op.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _alembic_cfg(db_url: str):
    from alembic.config import Config

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", db_url)
    return cfg


@pytest.fixture()
def migration_db(tmp_path, monkeypatch):
    db_path = tmp_path / "alembic.db"
    url = f"sqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)
    yield url


def test_alembic_upgrade_head_creates_all_tables(migration_db) -> None:
    from alembic import command

    cfg = _alembic_cfg(migration_db)
    command.upgrade(cfg, "head")

    eng = create_engine(migration_db)
    try:
        tables = set(inspect(eng).get_table_names())
    finally:
        eng.dispose()
    expected = {
        "module", "test_run", "telemetry_sample", "report", "operator",
        "equipment", "spare_part", "maintenance_ticket", "complaint_ticket",
        "ai_thread", "audit_log", "barcode_scan", "schedule",
        "alembic_version",
    }
    assert expected.issubset(tables), f"missing: {expected - tables}"


def test_alembic_upgrade_head_is_idempotent(migration_db) -> None:
    from alembic import command

    cfg = _alembic_cfg(migration_db)
    command.upgrade(cfg, "head")
    # Second invocation must be a no-op.
    command.upgrade(cfg, "head")
