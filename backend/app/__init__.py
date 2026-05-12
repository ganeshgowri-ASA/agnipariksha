"""``backend.app`` package — DB, models, AI agent and routers.

Historically this package re-exported the FastAPI ``app`` from
``backend.main`` so callers could write ``backend.app.main:app``. That
form is preserved through ``backend.app.main`` (which performs the
import lazily); importing this package no longer does so, which would
introduce a circular import now that ``backend.main`` includes the
routers defined here.
"""

__all__: list[str] = []
