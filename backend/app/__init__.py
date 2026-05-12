"""Compatibility package: ``backend.app`` re-exports the FastAPI app.

Lets callers use ``python -m uvicorn backend.app.main:app`` in addition
to the canonical ``backend.main:app`` invocation. The re-export is
guarded because when uvicorn is launched in script-mode from inside
``backend/`` (``python -m uvicorn main:app``) the top-level
``backend`` package is not importable — and several submodules
(``backend.app.tests.*``) need to load *without* triggering the
re-export cycle.
"""
try:
    from backend.main import app  # noqa: F401
except ModuleNotFoundError:  # script-mode launch: `backend` not on sys.path
    app = None  # type: ignore[assignment]

__all__ = ["app"]
