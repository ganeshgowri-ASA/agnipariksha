"""Compatibility package: ``backend.app`` re-exports the FastAPI ``app``.

Loading is *lazy* via :pep:`562` so importing a submodule (e.g. the test
state machines under ``backend.app.tests``) does not trigger a circular
import back into ``backend.main`` — which would also fail in script-mode
launches like ``python -m uvicorn main:app`` from inside the backend
directory, where the parent ``backend`` package is not on sys.path.
"""
from __future__ import annotations

__all__ = ["app"]


def __getattr__(name: str):  # PEP 562
    if name == "app":
        from backend.main import app as _app
        return _app
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
