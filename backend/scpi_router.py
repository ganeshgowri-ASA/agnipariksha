"""Minimal SCPI router exposing ``/api/scpi/{transport,idn,query}``.

This is the smallest piece of ``feat/pv6000-scpi-control`` that unblocks the
frontend's "Backend down" / wrong-transport banners and gives the lab-host
acceptance run a real V/I read path (``MEAS:VOLT?`` / ``MEAS:CURR?``).

Endpoints
---------
- ``GET /api/scpi/transport``        — current transport config + reachability
- ``GET /api/scpi/idn``              — issue ``*IDN?`` against the device
- ``GET /api/scpi/query?cmd=<scpi>`` — issue an arbitrary SCPI query, return the response

Live-mode failures (``DEMO_MODE=false`` + ITECH unreachable) translate to
HTTP 503 with ``{error: "scpi_unreachable", host, port, reason}``. The driver
NEVER silently falls back to simulator data in live mode.
"""
from __future__ import annotations

import asyncio
import os
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

try:
    from .config import get_settings
    from .scpi_async import ScpiClient, ScpiUnreachable, is_scpi_reachable
except ImportError:  # pragma: no cover - script-mode fallback
    from config import get_settings  # type: ignore[no-redef]
    from scpi_async import ScpiClient, ScpiUnreachable, is_scpi_reachable  # type: ignore[no-redef]


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


class QueryResponse(BaseModel):
    cmd: str
    response: str
    elapsed_ms: int
    demo: bool
    error: Optional[str] = None


def _transport_kind() -> str:
    """Honour ITECH_TRANSPORT env (set by the user's .env) with sane default."""
    return os.environ.get("ITECH_TRANSPORT", "scpi_tcp")


def _unreachable_503(exc: ScpiUnreachable) -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={
            "error": "scpi_unreachable",
            "host": exc.host,
            "port": exc.port,
            "reason": exc.reason,
        },
    )


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
    except ScpiUnreachable as exc:
        # Live-mode hardware fault — never mask with simulator data.
        raise _unreachable_503(exc)
    except Exception as exc:
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


@router.get("/query", response_model=QueryResponse)
async def get_query(
    cmd: str = Query(..., min_length=1, max_length=256, description="SCPI command, e.g. MEAS:VOLT?"),
) -> QueryResponse:
    s = get_settings()
    client = ScpiClient(demo_mode=s.DEMO_MODE)
    t0 = time.monotonic()
    err: Optional[str] = None
    response = ""
    try:
        await client.connect()
        response = await client.query(cmd)
    except ScpiUnreachable as exc:
        raise _unreachable_503(exc)
    except Exception as exc:
        err = f"{type(exc).__name__}: {exc}"
    finally:
        try:
            await client.close()
        except Exception:
            pass
    return QueryResponse(
        cmd=cmd,
        response=response or "",
        elapsed_ms=int((time.monotonic() - t0) * 1000),
        demo=s.DEMO_MODE,
        error=err,
    )
