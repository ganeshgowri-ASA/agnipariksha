"""SCPI HTTP router — ``/api/scpi/{transport,idn,query,diag}``.

The frontend "Backend down" / wrong-transport banners and the lab-host
acceptance run drive against these endpoints. The driver NEVER silently
falls back to simulator data in live mode: a live-mode connect/query
failure raises :class:`ScpiUnreachable` which is translated to HTTP 503
with a structured ``{error: "scpi_unreachable", host, port, reason}``
body.

Endpoints
---------
- ``GET /api/scpi/transport``        — current transport config + reachability
- ``GET /api/scpi/idn``              — issue ``*IDN?`` against the device
- ``GET /api/scpi/query?cmd=<scpi>`` — issue an arbitrary SCPI query, return the response
- ``GET /api/scpi/diag``             — verbose probe useful when ``scpi_reachable=false``
  (returns the source/target socket info and the OS-level error string the
  TCP probe got back, so a user can tell "wrong interface" from "port
  closed" from "timeout")
"""
from __future__ import annotations

import asyncio
import os
import socket
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

try:
    from ..basic_check import PASS_TTL_S, get_store, is_psu_energize_cmd
    from ..config import get_settings
    from ..scpi_async import ScpiClient, ScpiUnreachable, is_scpi_reachable
except ImportError:  # pragma: no cover - script-mode fallback
    from basic_check import PASS_TTL_S, get_store, is_psu_energize_cmd  # type: ignore[no-redef]
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


class DiagResponse(BaseModel):
    host: str
    port: int
    demo: bool
    reachable: bool
    probe_ms: int
    timeout_ms: int
    source_address: Optional[str] = None
    source_interface_hint: Optional[str] = None
    os_error: Optional[str] = None
    transport: str


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


def _enforce_basic_check_gate(cmd: str, module_id: Optional[str]) -> None:
    """Refuse PSU-energizing commands without a recent Basic Check pass.

    CRITICAL: This guard runs in BOTH demo and live modes. The simulator
    is still a write path — we want operators to learn the gate in demo
    before they ever hit live hardware.
    """
    if not is_psu_energize_cmd(cmd):
        return
    if not module_id:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "basic_check_required",
                "reason": "module_id query parameter is required for PSU energization commands",
                "cmd": cmd,
                "ttl_s": PASS_TTL_S,
            },
        )
    passed, age, _rec = get_store().status(module_id)
    if not passed:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "basic_check_required",
                "module_id": module_id,
                "reason": (
                    f"no Basic Check PASS for module_id={module_id!r} within last "
                    f"{PASS_TTL_S}s (age_s={age})"
                ),
                "cmd": cmd,
                "age_s": age,
                "ttl_s": PASS_TTL_S,
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
    module_id: Optional[str] = Query(
        default=None,
        max_length=128,
        description="Required for PSU-energizing commands (OUTP ON / VOLT / CURR); ignored for queries",
    ),
) -> QueryResponse:
    _enforce_basic_check_gate(cmd, module_id)
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


def _probe_with_diag(host: str, port: int, timeout_ms: int) -> dict:
    """Synchronous TCP probe that returns full diagnostic detail.

    Reports the OS-chosen source address — useful on multi-homed Windows
    hosts where the Wi-Fi default route hijacks lab subnet traffic that
    should go through Ethernet. Connecting twice (once with SO_KEEPALIVE
    off, once with SO_REUSEADDR) is intentionally avoided; we want to
    mirror what asyncio.open_connection does in the live path.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout_ms / 1000.0)
    src_addr: Optional[str] = None
    os_err: Optional[str] = None
    ok = False
    try:
        sock.connect((host, port))
        src = sock.getsockname()
        src_addr = f"{src[0]}:{src[1]}"
        ok = True
    except (OSError, socket.timeout) as exc:
        os_err = f"{type(exc).__name__}: {exc}"
        try:
            src = sock.getsockname()
            if src and src[0] not in ("0.0.0.0", ""):
                src_addr = f"{src[0]}:{src[1]}"
        except OSError:
            src_addr = None
    finally:
        try:
            sock.close()
        except OSError:
            pass

    iface_hint: Optional[str] = None
    if src_addr:
        src_ip = src_addr.split(":", 1)[0]
        host_octets = host.split(".")
        src_octets = src_ip.split(".")
        if len(host_octets) == 4 and len(src_octets) == 4 and host_octets[:3] == src_octets[:3]:
            iface_hint = f"same /24 as target ({'.'.join(host_octets[:3])}.0/24)"
        else:
            iface_hint = f"different subnet from target — check route table for {host}"
    return {
        "ok": ok,
        "source_address": src_addr,
        "source_interface_hint": iface_hint,
        "os_error": os_err,
    }


@router.get("/diag", response_model=DiagResponse)
async def get_diag() -> DiagResponse:
    """Verbose connectivity probe — exists so a user can quickly tell
    "wrong interface" from "device offline" from "firewall" without
    leaving the browser. Safe in both demo and live mode; never raises.
    """
    s = get_settings()
    t0 = time.monotonic()
    diag = await asyncio.get_event_loop().run_in_executor(
        None, _probe_with_diag, s.ITECH_IP, s.ITECH_PORT, s.ITECH_TIMEOUT_MS,
    )
    probe_ms = int((time.monotonic() - t0) * 1000)
    return DiagResponse(
        host=s.ITECH_IP,
        port=s.ITECH_PORT,
        demo=s.DEMO_MODE,
        reachable=diag["ok"],
        probe_ms=probe_ms,
        timeout_ms=s.ITECH_TIMEOUT_MS,
        source_address=diag["source_address"],
        source_interface_hint=diag["source_interface_hint"],
        os_error=diag["os_error"],
        transport=_transport_kind(),
    )
