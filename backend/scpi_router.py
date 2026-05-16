"""Minimal SCPI router exposing ``/api/scpi/{transport,idn,query,smoke}``.

This is the smallest piece of ``feat/pv6000-scpi-control`` that unblocks the
frontend's "Backend down" / wrong-transport banners and gives the lab-host
acceptance run a real V/I read path (``MEAS:VOLT?`` / ``MEAS:CURR?``).

Endpoints
---------
- ``GET /api/scpi/transport``        — current transport config + reachability
- ``GET /api/scpi/idn``              — issue ``*IDN?`` against the ITECH only
- ``GET /api/scpi/query?cmd=<scpi>`` — issue an arbitrary SCPI query, return the response
- ``GET /api/scpi/smoke``            — issue ``*IDN?`` against every registered
                                       device in parallel; always 200, per-device
                                       errors are captured inline.

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
    from .app.devices import get_registry
except ImportError:  # pragma: no cover - script-mode fallback
    from config import get_settings  # type: ignore[no-redef]
    from scpi_async import ScpiClient, ScpiUnreachable, is_scpi_reachable  # type: ignore[no-redef]
    from app.devices import get_registry  # type: ignore[no-redef]


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


class SmokeDeviceResult(BaseModel):
    id: str
    name: str
    role: str
    kind: str
    demo: bool
    ok: bool
    idn: str
    error: Optional[str] = None
    elapsed_ms: int


class SmokeResponse(BaseModel):
    ok: bool
    mode: str  # "demo" | "live"
    devices: list[SmokeDeviceResult]
    elapsed_ms: int


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


async def _smoke_one_device(device) -> SmokeDeviceResult:
    """Probe one device with ``*IDN?`` (or a fallback for non-SCPI kinds).

    Always returns a result — never raises. SCPI devices get a literal
    ``*IDN?`` query. Modbus / RS232 devices in live mode would parse-error
    on ``*IDN?``, so they fall back to ``transport.is_alive()`` which the
    transport already knows how to do per protocol. In demo mode every
    transport returns its synthetic demo string, so ``*IDN?`` works for all.
    """
    t = device.get_transport()
    t0 = time.monotonic()
    idn = ""
    ok = False
    err: Optional[str] = None
    try:
        # Lazy connect — the background health loop usually has it primed,
        # but a single immediate retry costs us at most ITECH_TIMEOUT_MS.
        if t.state.value in ("init", "closed", "down") and not device.demo:
            await t.connect(max_attempts=1)
        # The shared Transport.query falls back to _demo_response when state
        # is DOWN/INIT (designed for non-blocking demo runs). In live mode
        # that's misleading for a smoke check — surface the real fault.
        if not device.demo and t.state.value in ("down", "init", "closed"):
            err = t.last_error or f"transport state={t.state.value}"
        elif device.demo or device.transport_kind.startswith("scpi"):
            idn = await asyncio.wait_for(t.query("*IDN?"), timeout=2.0)
            ok = bool(idn)
        else:
            alive = await asyncio.wait_for(t.is_alive(), timeout=2.0)
            idn = f"(alive: {device.transport_kind})" if alive else ""
            ok = alive
    except Exception as exc:  # noqa: BLE001 — smoke must always return
        err = f"{type(exc).__name__}: {exc}"
    return SmokeDeviceResult(
        id=device.id,
        name=device.name,
        role=device.role,
        kind=device.transport_kind,
        demo=bool(device.demo),
        ok=ok,
        idn=idn,
        error=err,
        elapsed_ms=int((time.monotonic() - t0) * 1000),
    )


@router.get("/smoke", response_model=SmokeResponse)
async def get_smoke() -> SmokeResponse:
    """Run ``*IDN?`` against every registered device, in parallel.

    Always returns 200. Per-device failures show up as ``ok=false`` with the
    captured exception string — the operator decides what to do, the API
    never silently masks a fault.
    """
    s = get_settings()
    t0 = time.monotonic()
    devices = list(get_registry().all())
    results = await asyncio.gather(*[_smoke_one_device(d) for d in devices])
    return SmokeResponse(
        ok=bool(results) and all(r.ok for r in results),
        mode="demo" if s.DEMO_MODE else "live",
        devices=list(results),
        elapsed_ms=int((time.monotonic() - t0) * 1000),
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
