"""HTTP + WebSocket routes for the Ground Continuity Test (GCT).

Endpoints
---------
- ``GET  /api/gct/config``   — current pass threshold + DMM target
- ``POST /api/gct/measure``  — one-shot 4-wire resistance read
- ``WS   /ws/gct/live``      — streams ``GctReading`` JSON payloads

Safety
------
GCT is a DMM-only flow per IEC 61730-2 MST 13. The ITECH PV6000 output
must remain OFF for the duration. Both the REST and WS handlers issue
an explicit ``OUTP OFF`` to the PSU **before** any DMM operation; if
the PSU is unreachable the GCT path still runs because the DMM has its
own current source.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

try:
    from .app.devices import get_registry
    from .app.gct import (
        DEFAULT_MAX_RESISTANCE_OHM,
        GctReading,
        KeysightDmmGct,
    )
    from .config import get_settings
    from .scpi_async import ScpiClient, ScpiUnreachable
except ImportError:  # pragma: no cover - script-mode fallback
    from app.devices import get_registry  # type: ignore[no-redef]
    from app.gct import (  # type: ignore[no-redef]
        DEFAULT_MAX_RESISTANCE_OHM,
        GctReading,
        KeysightDmmGct,
    )
    from config import get_settings  # type: ignore[no-redef]
    from scpi_async import ScpiClient, ScpiUnreachable  # type: ignore[no-redef]


_LOG = logging.getLogger("agnipariksha.gct")

router = APIRouter(prefix="/api/gct", tags=["gct"])

# Module-level so the WS endpoint can share the same router instance.
ws_router = APIRouter(tags=["gct"])


class GctMeasureRequest(BaseModel):
    max_resistance: Optional[float] = Field(
        default=None,
        gt=0.0,
        le=10.0,
        description="Pass threshold in ohms; defaults to 0.1 Ω per IEC 61730-2.",
    )


class GctMeasureResponse(BaseModel):
    timestamp: int
    resistance: float
    passed: bool
    max_resistance: float
    source: str
    demo: bool
    psu_output_off: bool


class GctConfigResponse(BaseModel):
    max_resistance: float
    dmm_device_id: str
    dmm_demo: bool
    standard: str = "IEC 61730-2 MST 13"
    method: str = "4-wire resistance via Keysight 34465A"


_DMM_DEVICE_ID = "dmm_keysight"


def _build_dmm(max_resistance: Optional[float]) -> KeysightDmmGct:
    """Resolve the DMM from the device registry and instantiate the
    GCT controller. Falls back to demo mode if the device entry is
    missing or marked demo."""
    s = get_settings()
    reg = get_registry()
    device = reg.get(_DMM_DEVICE_ID)
    # Honour the global DEMO_MODE flag too — operators flip it to drive
    # the entire backend into simulation regardless of per-device state.
    demo = s.DEMO_MODE or device is None or device.demo
    transport = None
    if not demo and device is not None:
        try:
            transport = device.get_transport()
        except Exception as exc:  # noqa: BLE001
            _LOG.warning("DMM transport build failed, falling back to demo: %s", exc)
            demo = True
            transport = None
    dmm = KeysightDmmGct(
        transport=transport,
        demo=demo,
        max_resistance=max_resistance if max_resistance is not None else DEFAULT_MAX_RESISTANCE_OHM,
    )
    return dmm


async def _ensure_psu_off() -> bool:
    """Belt-and-braces: send ``OUTP OFF`` to the ITECH PSU. Returns
    True if the command was issued (or skipped because demo). Never
    raises — a missing PSU should not block a DMM-only test."""
    s = get_settings()
    client = ScpiClient(demo_mode=s.DEMO_MODE)
    try:
        try:
            await client.connect(max_attempts=1)
        except ScpiUnreachable:
            # PSU not reachable — that's fine for GCT since the DMM
            # handles current sourcing on its own.
            return s.DEMO_MODE
        await client.send("OUTP OFF")
        return True
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("PSU OUTP OFF preflight failed (continuing): %s", exc)
        return False
    finally:
        try:
            await client.close()
        except Exception:
            pass


@router.get("/config", response_model=GctConfigResponse)
async def gct_config() -> GctConfigResponse:
    s = get_settings()
    reg = get_registry()
    device = reg.get(_DMM_DEVICE_ID)
    dmm_demo = s.DEMO_MODE or device is None or device.demo
    return GctConfigResponse(
        max_resistance=DEFAULT_MAX_RESISTANCE_OHM,
        dmm_device_id=_DMM_DEVICE_ID,
        dmm_demo=dmm_demo,
    )


@router.post("/measure", response_model=GctMeasureResponse)
async def gct_measure(body: Optional[GctMeasureRequest] = None) -> GctMeasureResponse:
    """One-shot 4-wire resistance measurement. PSU output is forced OFF
    before the DMM read."""
    max_r = body.max_resistance if body is not None else None
    psu_off = await _ensure_psu_off()
    dmm = _build_dmm(max_r)
    try:
        await dmm.configure_4wire()
        reading = await dmm.measure()
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "dmm_unreachable", "reason": f"{type(exc).__name__}: {exc}"},
        ) from exc
    return GctMeasureResponse(
        timestamp=reading.timestamp,
        resistance=reading.resistance,
        passed=reading.passed,
        max_resistance=reading.max_resistance,
        source=reading.source,
        demo=reading.demo,
        psu_output_off=psu_off,
    )


@ws_router.websocket("/ws/gct/live")
async def gct_live(ws: WebSocket) -> None:
    """Stream GCT 4-wire resistance readings + pass/fail until the client
    disconnects.

    Query params:
        max_resistance — pass threshold override (default 0.1)
        interval       — seconds between samples (default 0.5, min 0.1)
    """
    await ws.accept()

    raw_max = ws.query_params.get("max_resistance")
    try:
        max_r = float(raw_max) if raw_max is not None else None
        if max_r is not None and max_r <= 0:
            raise ValueError("max_resistance must be > 0")
    except ValueError:
        await ws.send_text(json.dumps({"type": "error", "error": "bad_max_resistance"}))
        await ws.close()
        return

    raw_iv = ws.query_params.get("interval", "0.5")
    try:
        interval = max(0.1, float(raw_iv))
    except ValueError:
        interval = 0.5

    psu_off = await _ensure_psu_off()
    await ws.send_text(json.dumps({
        "type": "gct_status",
        "psu_output_off": psu_off,
        "interval_s": interval,
        "max_resistance": max_r if max_r is not None else DEFAULT_MAX_RESISTANCE_OHM,
        "ts": int(time.time() * 1000),
    }))

    dmm = _build_dmm(max_r)
    try:
        await dmm.configure_4wire()
    except Exception as exc:  # noqa: BLE001
        await ws.send_text(json.dumps({
            "type": "error", "error": "dmm_configure_failed",
            "reason": f"{type(exc).__name__}: {exc}",
        }))
        await ws.close()
        return

    stop_evt = asyncio.Event()

    async def producer() -> None:
        try:
            async for reading in dmm.stream(interval_s=interval):
                if stop_evt.is_set():
                    return
                await ws.send_text(json.dumps(reading.to_dict()))
        except asyncio.CancelledError:
            pass
        except Exception as exc:  # noqa: BLE001
            try:
                await ws.send_text(json.dumps({
                    "type": "error", "error": "dmm_read_failed",
                    "reason": f"{type(exc).__name__}: {exc}",
                }))
            except Exception:
                pass
            stop_evt.set()

    async def consumer() -> None:
        try:
            while not stop_evt.is_set():
                raw = await ws.receive_text()
                # Accept minimal control messages; future-proof but currently
                # only ``stop`` and ``ping`` are honoured.
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if msg.get("type") == "stop":
                    stop_evt.set()
                    return
                if msg.get("type") == "ping":
                    await ws.send_text(json.dumps({"type": "pong", "ts": int(time.time() * 1000)}))
        except WebSocketDisconnect:
            stop_evt.set()
        except Exception:
            stop_evt.set()

    prod_task = asyncio.create_task(producer())
    cons_task = asyncio.create_task(consumer())
    try:
        await stop_evt.wait()
    finally:
        for t in (prod_task, cons_task):
            t.cancel()
        await asyncio.gather(prod_task, cons_task, return_exceptions=True)
        try:
            await ws.close()
        except Exception:
            pass
