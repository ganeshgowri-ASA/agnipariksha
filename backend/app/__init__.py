"""Compatibility package: ``backend.app`` re-exports the FastAPI app.

Lets callers use ``python -m uvicorn backend.app.main:app`` in addition
to the canonical ``backend.main:app`` invocation. The ``app`` attribute
is loaded lazily to avoid an import cycle when ``backend.main`` imports
submodules of this package (devices, transports, health, reliability).
When loaded from a context where the ``backend`` parent package is not
importable (e.g. uvicorn launched as ``main:app`` from inside the
``backend/`` cwd — how the CI smoke script invokes it), the lazy hook
raises AttributeError on ``app`` access but submodules like
``app.reliability`` remain importable.
"""
from __future__ import annotations


def __getattr__(name: str):
    if name == "app":
        try:
            from backend.main import app as _app
        except ImportError as exc:  # pragma: no cover - script-mode fallback
            raise AttributeError(f"backend.app.app unavailable: {exc}") from exc
        return _app
    raise AttributeError(f"module 'backend.app' has no attribute {name!r}")


__all__ = ["app"]
