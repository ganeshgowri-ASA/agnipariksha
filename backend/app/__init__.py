"""Compatibility package: ``backend.app`` re-exports the FastAPI app.

Lets callers use ``python -m uvicorn backend.app.main:app`` in addition
to the canonical ``backend.main:app`` invocation.

Re-export is best-effort: in script-mode (uvicorn launched from inside
``backend/`` with module path ``main:app``) the ``backend`` package is
not importable, and any submodule access (e.g. ``app.tests.ground_continuity``)
would otherwise hit a circular import attempting to load
``backend.main`` from inside main.py itself.
"""
try:
    from backend.main import app  # noqa: F401
except ImportError:
    app = None  # type: ignore[assignment]

__all__ = ["app"]
