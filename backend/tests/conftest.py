"""Shared pytest fixtures.

Every DB test runs against a fresh in-memory SQLite engine — no files, no
shared state between cases. ``DB_BACKFILL_ON_STARTUP`` is disabled
globally so importing the FastAPI app in unrelated tests doesn't poke at
the filesystem.
"""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path
from typing import Iterator

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("DB_BACKFILL_ON_STARTUP", "false")


@pytest.fixture()
def sqlite_engine():
    """Per-test in-memory SQLite engine, schema applied via SQLModel.

    StaticPool keeps the in-memory DB attached across the test's threads.
    """
    # Force model registration so SQLModel.metadata is populated.
    from backend.db import models  # noqa: F401

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture()
def db_session(sqlite_engine) -> Iterator[Session]:
    with Session(sqlite_engine) as s:
        yield s


@pytest.fixture()
def isolated_db_url(tmp_path, monkeypatch):
    """Point the cached engine at a tmp SQLite file for a single test."""
    from backend.db import session as session_mod

    url = f"sqlite:///{tmp_path / f'test-{uuid.uuid4().hex}.db'}"
    monkeypatch.setenv("DATABASE_URL", url)
    session_mod.reset_engine()
    try:
        yield url
    finally:
        session_mod.reset_engine()
