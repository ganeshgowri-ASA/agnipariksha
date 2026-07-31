"""Regression smoke test: the SCPI router MUST be mounted on the FastAPI app.

History
-------
PR #40 introduced ``backend/scpi_router.py`` with an ``APIRouter(prefix="/api/scpi")``
and PR #40's ``main.py`` change wired it via ``app.include_router(scpi_router)``.
The wiring is one line and easy to drop during a merge, a rename, or a refactor —
when that happens, every ``/api/scpi/*`` URL silently 404s and the lab box looks
broken even though the module exists on disk. This test fails the build if that
ever regresses.

Contract checked
----------------
- ``GET /api/scpi/transport`` is reachable (status != 404)
- ``GET /api/scpi/idn``       is reachable (status != 404)
- ``GET /api/scpi/query?cmd=*IDN?`` is reachable (status != 404)

We deliberately do not assert 200 here — in live mode against unreachable
hardware these endpoints can return 503 (``scpi_unreachable``), and that is
correct behaviour. The point is solely to prove the routes are mounted.
"""
from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

try:
    from backend.main import app  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - script-mode fallback for backend-cwd CI
    from main import app  # type: ignore[no-redef]


SCPI_ROUTES = ("/api/scpi/transport", "/api/scpi/idn", "/api/scpi/query")


@pytest.fixture(scope="module", autouse=True)
def _force_demo_mode() -> None:
    """Run the smoke test against the demo simulator so it doesn't depend on
    lab-host network reachability. We only care about the mount, not the
    hardware behaviour."""
    prev = os.environ.get("DEMO_MODE")
    os.environ["DEMO_MODE"] = "true"
    # ``get_settings`` is lru_cache'd; clear it so the env change takes effect.
    try:
        from backend.config import get_settings  # type: ignore[import-not-found]
    except ImportError:  # pragma: no cover
        from config import get_settings  # type: ignore[no-redef]
    get_settings.cache_clear()
    yield
    if prev is None:
        os.environ.pop("DEMO_MODE", None)
    else:
        os.environ["DEMO_MODE"] = prev
    get_settings.cache_clear()


def test_scpi_routes_present_in_router_table() -> None:
    """The mounted route table itself must list the SCPI paths — catches the
    case where the include_router call is missing or the router is created
    but never attached.
    """
    paths = {getattr(r, "path", None) for r in app.routes}
    missing = [p for p in SCPI_ROUTES if p not in paths]
    assert not missing, (
        f"SCPI routes missing from app.routes: {missing}. "
        f"Check that backend/main.py calls app.include_router(scpi_router). "
        f"Mounted /api routes: {sorted(p for p in paths if p and p.startswith('/api'))}"
    )


def test_scpi_transport_not_404() -> None:
    with TestClient(app) as c:
        r = c.get("/api/scpi/transport")
    assert r.status_code != 404, (
        f"/api/scpi/transport returned 404 — SCPI router is not mounted. "
        f"Add `app.include_router(scpi_router)` in backend/main.py."
    )


def test_scpi_idn_not_404() -> None:
    with TestClient(app) as c:
        r = c.get("/api/scpi/idn")
    assert r.status_code != 404, (
        f"/api/scpi/idn returned 404 — SCPI router is not mounted."
    )


def test_scpi_query_not_404() -> None:
    with TestClient(app) as c:
        r = c.get("/api/scpi/query", params={"cmd": "*IDN?"})
    assert r.status_code != 404, (
        f"/api/scpi/query returned 404 — SCPI router is not mounted."
    )
