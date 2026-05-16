"""Minimal SCPI router exposing `/api/scpi/idn` and `/api/scpi/transport`.

This is the smallest piece of `feat/pv6000-scpi-control` that unblocks the
frontend's "Backend down" / wrong-transport banners. It does not implement
E-STOP, watchdog, or multi-supply rack — those remain on the scaffold branch
(``docs/scopes/pv6000-scpi-control.md``).

Endpoints
---------
- GET /api/scpi/transport  — current transport config + reachability probe
- GET /api/scpi/idn        — issue ``*IDN?`` against the device; demo-aware
"""
from __future__ import annotations

import asyncio
import os
import time
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

try:
    from .config import get_settings
    from .scpi_async import ScpiClient, is_scpi_reachable
except ImportError:  # pragma: no cover - script-mode fallback
    from config import get_settings  # type: ignore[no-redef]
    from scpi_async import ScpiClient, is_scpi_reachable  # type: ignore[no-redef]


router = APIRouter(prefix="/api/scpi", tags=["scpi"])


class TransportInfo(BaseModel):
    kind: str
    host: str
    port: int
    demo: bool
    reachable: bool
    probe_ms: int


class IdnResponse(BaseModel):
    idn: str
    demo: bool
    transport: str
    host: str
    port: int
    elapsed_ms: int
    error: Optional[str] = None


def _transport_kind() -> str:
    """Honour ITECH_TRANSPORT env (set by the user's .env) with sane default."""
    return os.environ.get("ITECH_TRANSPORT", "scpi_tcp")


@router.get("/transport", response_model=TransportInfo)
async def get_transport() -> TransportInfo:
    s = get_settings()
    t0 = time.monotonic()
    reachable = await asyncio.get_event_loop().run_in_executor(
        None,
        is_scpi_reachable,
        s.ITECH_IP,
        s.ITECH_PORT,
        s.ITECH_TIMEOUT_MS,
    )
    return TransportInfo(
        kind=_transport_kind(),
        host=s.ITECH_IP,
        port=s.ITECH_PORT,
        demo=s.DEMO_MODE,
        reachable=reachable,
        probe_ms=int((time.monotonic() - t0) * 1000),
    )


@router.get("/idn", response_model=IdnResponse)
async def get_idn() -> IdnResponse:
    s = get_settings()
    client = ScpiClient(demo_mode=s.DEMO_MODE)
    t0 = time.monotonic()
    err: Optional[str] = None
    idn = ""
    try:
        await client.connect()
        idn = await client.query("*IDN?")
    except Exception as exc:  # surface, don't crash the request
        err = f"{type(exc).__name__}: {exc}"
    finally:
        try:
            await client.close()
        except Exception:
            pass
    return IdnResponse(
        idn=idn or "",
        demo=s.DEMO_MODE,
        transport=_transport_kind(),
        host=s.ITECH_IP,
        port=s.ITECH_PORT,
        elapsed_ms=int((time.monotonic() - t0) * 1000),
        error=err,
    )
