"""Compatibility package: ``backend.app`` re-exports the FastAPI app.

Lets callers use ``python -m uvicorn backend.app.main:app`` in addition
to the canonical ``backend.main:app`` invocation. The ``app`` attribute
is loaded lazily to avoid an import cycle when ``backend.main`` imports
submodules of this package (devices, transports, health).
"""
from __future__ import annotations


def __getattr__(name: str):
    if name == "app":
        from backend.main import app as _app
        return _app
    raise AttributeError(f"module 'backend.app' has no attribute {name!r}")


__all__ = ["app"]
