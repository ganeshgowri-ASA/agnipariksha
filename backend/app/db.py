"""SQLite persistence for Modules, TestRuns and AI threads.

Single source of truth used by routers and the AI agent's tools.
The DB file path can be overridden via ``AGNI_DB_PATH`` (used by tests).
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from sqlmodel import Session, SQLModel, create_engine

_engine = None
_current_url: str | None = None


def _resolve_db_url() -> str:
    override = os.environ.get("AGNI_DB_PATH")
    if override:
        if override.startswith("sqlite"):
            return override
        return f"sqlite:///{override}"
    repo_root = Path(__file__).resolve().parents[2]
    db_dir = repo_root / "data"
    db_dir.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{db_dir / 'agnipariksha.db'}"


def get_engine():
    global _engine, _current_url
    url = _resolve_db_url()
    if _engine is None or url != _current_url:
        _engine = create_engine(
            url,
            echo=False,
            connect_args={"check_same_thread": False},
        )
        _current_url = url
        # Importing here so models are registered with SQLModel.metadata before
        # ``create_all`` runs.
        from . import models  # noqa: F401
        SQLModel.metadata.create_all(_engine)
    return _engine


def reset_engine_for_tests() -> None:
    """Force the engine to be rebuilt — tests override ``AGNI_DB_PATH``."""
    global _engine, _current_url
    _engine = None
    _current_url = None


@contextmanager
def session_scope() -> Iterator[Session]:
    eng = get_engine()
    with Session(eng) as s:
        yield s


def get_session() -> Iterator[Session]:
    """FastAPI dependency."""
    eng = get_engine()
    with Session(eng) as s:
        yield s
