"""Alias module: ``backend.app.main`` re-exports the FastAPI app."""
from backend.main import app  # noqa: F401

__all__ = ["app"]
