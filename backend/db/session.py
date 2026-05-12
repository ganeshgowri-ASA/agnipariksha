"""Engine + session helpers.

A single process-wide engine is cached and rebuilt on demand (handy for
tests that swap DATABASE_URL between cases). SQLite URLs auto-enable the
``check_same_thread=False`` flag so FastAPI request handlers can share the
engine across threads.
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, create_engine

DEFAULT_SQLITE_URL = "sqlite:///./data/agnipariksha.db"

_engine: Optional[Engine] = None
_engine_url: Optional[str] = None


def _connect_args_for(url: str) -> dict:
    if url.startswith("sqlite"):
        return {"check_same_thread": False}
    return {}


def _ensure_sqlite_parent_dir(url: str) -> None:
    """For file-backed SQLite, create the parent directory if missing."""
    if not url.startswith("sqlite"):
        return
    # sqlite:///relative/path.db    -> ./relative/path.db
    # sqlite:////absolute/path.db   -> /absolute/path.db
    # sqlite:///:memory:            -> skip
    prefix = "sqlite:///"
    if not url.startswith(prefix):
        return
    raw = url[len(prefix):]
    if not raw or raw.startswith(":memory:"):
        return
    path = Path(raw)
    parent = path.parent
    if parent and str(parent) not in ("", "."):
        parent.mkdir(parents=True, exist_ok=True)


def create_engine_from_url(url: str, *, echo: bool = False) -> Engine:
    _ensure_sqlite_parent_dir(url)
    return create_engine(url, echo=echo, connect_args=_connect_args_for(url))


def get_engine(url: Optional[str] = None) -> Engine:
    """Return the cached engine, creating it on first use.

    Passing a URL different from the cached one rebuilds the engine — this
    lets tests point at ``sqlite://`` (in-memory) without process restart.
    """
    global _engine, _engine_url
    resolved = url or os.environ.get("DATABASE_URL") or DEFAULT_SQLITE_URL
    if _engine is None or _engine_url != resolved:
        if _engine is not None:
            _engine.dispose()
        _engine = create_engine_from_url(resolved)
        _engine_url = resolved
    return _engine


def reset_engine() -> None:
    """Drop the cached engine. Mostly useful between tests."""
    global _engine, _engine_url
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _engine_url = None


def init_db(url: Optional[str] = None) -> Engine:
    """Create all tables on the active engine. Idempotent.

    Alembic owns the production schema; this helper exists for tests and
    for the SQLite default where running migrations adds no value.
    """
    # Force model import so SQLModel.metadata is populated even if the caller
    # only imported ``backend.db``.
    from . import models  # noqa: F401

    eng = get_engine(url)
    SQLModel.metadata.create_all(eng)
    return eng


@contextmanager
def get_session(url: Optional[str] = None) -> Iterator[Session]:
    eng = get_engine(url)
    with Session(eng) as session:
        yield session
