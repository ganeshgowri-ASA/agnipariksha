"""Compatibility package: ``backend.app`` exposes the FastAPI app.

The re-export is lazy so that importing a submodule (e.g.
``backend.app.tests.damp_heat``) does not trigger a load of
``backend.main`` — that would create a circular import when uvicorn
boots ``main:app`` directly and then imports a submodule from this
package. Callers asking for ``backend.app.app`` still get the live
FastAPI instance.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - types only
    from fastapi import FastAPI


def __getattr__(name: str) -> "FastAPI":
    if name == "app":
        from backend.main import app as _app
        return _app
    raise AttributeError(f"module 'backend.app' has no attribute {name!r}")


__all__ = ["app"]
