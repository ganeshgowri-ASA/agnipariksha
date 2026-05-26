"""Smoke test: every supported import path resolves to the same FastAPI app.

The canonical ASGI target is ``backend.main:app``. Two compatibility shims
re-export it — the ``backend.app.main`` alias module and the lazy
``backend.app.app`` package attribute — so a regression in either fails here
with a clear signal instead of at deploy time.
"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def test_canonical_path_exposes_fastapi_app() -> None:
    from backend.main import app

    assert isinstance(app, FastAPI)


def test_alias_module_resolves_to_same_app() -> None:
    from backend.main import app as canonical
    from backend.app.main import app as alias

    assert isinstance(alias, FastAPI)
    assert alias is canonical


def test_package_attribute_resolves_to_same_app() -> None:
    import backend.app
    from backend.main import app as canonical

    assert backend.app.app is canonical
