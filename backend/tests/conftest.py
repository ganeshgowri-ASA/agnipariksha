"""Shared pytest fixtures for the AI assistant test suite.

Each test gets a fresh SQLite file via ``AGNI_DB_PATH`` so the engine
can be rebuilt without contaminating the real ``data/agnipariksha.db``.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path
from typing import Iterator

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@pytest.fixture()
def temp_db(monkeypatch: pytest.MonkeyPatch) -> Iterator[str]:
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AGNI_DB_PATH", tmp.name)
    # Force engine rebuild on next access.
    from backend.app import db as db_module
    db_module.reset_engine_for_tests()
    yield tmp.name
    db_module.reset_engine_for_tests()
    try:
        os.unlink(tmp.name)
    except OSError:
        pass
