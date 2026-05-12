"""Compatibility package: ``backend.app`` re-exports the FastAPI app.

Lets callers use ``python -m uvicorn backend.app.main:app`` in addition
to the canonical ``backend.main:app`` invocation.
"""
from backend.main import app  # noqa: F401

__all__ = ["app"]
