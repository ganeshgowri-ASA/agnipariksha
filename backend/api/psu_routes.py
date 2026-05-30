# PSU health probe (Tab-4 transport contract). Wraps the existing scpi_async
# connect retry/backoff and exposes a structured JSON envelope so the
# dashboard tiles (PR-62c) can render Power Supply state without inferring
# from /api/scpi/transport + /api/scpi/idn separately.
from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

try:
    from ..config import get_settings
    from ..scpi_async import ScpiClient, ScpiUnreachable
except ImportError:  # pragma: no cover - script-mode fallback
    from config import get_settings  # type: ignore[no-redef]
    from scpi_async import ScpiClient, ScpiUnreachable  # type: ignore[no-redef]


router = APIRouter(prefix="/api/psu", tags=["psu"])


class PsuHealth(BaseModel):
    """Transport contract for the Power Supply tile (PR-62c reads this)."""
    ok: bool                  # overall: can talk to a PSU (real or simulator)
    reachable: bool           # real TCP socket established (always False in demo)
    host: str
    port: int
    transport: str            # "scpi_tcp" by default; ITECH_TRANSPORT overrides
    demo: bool
    timeout_ms: int           # per-attempt connect timeout
    retry_attempts: int       # configured connect-retry budget
    latency_ms: int           # total elapsed for the probe
    idn: Optional[str]        # *IDN? response (simulator string in demo)
    last_error: Optional[str] # ScpiUnreachable.reason or other error
    checked_at: str           # ISO8601 UTC


@router.get("/health", response_model=PsuHealth)
async def psu_health() -> PsuHealth:
    s = get_settings()
    t0 = time.monotonic()
    client = ScpiClient(demo_mode=s.DEMO_MODE)
    idn: Optional[str] = None
    last_error: Optional[str] = None
    reachable = False
    try:
        connected = await client.connect(max_attempts=s.ITECH_RETRY_ATTEMPTS)
        reachable = bool(connected)  # False in demo (no real socket)
        # *IDN? works in both demo (simulator string) and live.
        idn = (await client.query("*IDN?")).strip() or None
    except ScpiUnreachable as exc:
        last_error = exc.reason
    except asyncio.TimeoutError as exc:
        last_error = f"TimeoutError: {exc}"
    except Exception as exc:  # pragma: no cover - defensive
        last_error = f"{type(exc).__name__}: {exc}"
    finally:
        try:
            await client.close()
        except Exception:
            pass
    ok = (last_error is None) and (reachable or s.DEMO_MODE)
    return PsuHealth(
        ok=ok,
        reachable=reachable,
        host=s.ITECH_IP,
        port=s.ITECH_PORT,
        transport=os.environ.get("ITECH_TRANSPORT", "scpi_tcp"),
        demo=s.DEMO_MODE,
        timeout_ms=s.ITECH_TIMEOUT_MS,
        retry_attempts=s.ITECH_RETRY_ATTEMPTS,
        latency_ms=int((time.monotonic() - t0) * 1000),
        idn=idn,
        last_error=last_error,
        checked_at=datetime.now(timezone.utc).isoformat(),
    )
