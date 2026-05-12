"""Compatibility package: ``backend.app`` lazily re-exports the FastAPI app.

Lets callers use ``python -m uvicorn backend.app.main:app`` in addition
to the canonical ``backend.main:app`` invocation, while avoiding a
circular import when ``backend.main`` imports submodules of this
package (e.g. ``backend.app.tests``).
"""
from __future__ import annotations

from typing import Any


def __getattr__(name: str) -> Any:
    if name == "app":
        from backend.main import app as _app
        return _app
    raise AttributeError(name)


__all__ = ["app"]
