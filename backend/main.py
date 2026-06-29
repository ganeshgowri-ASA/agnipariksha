"""FastAPI backend for Agnipariksha PV test station.

Endpoints
---------
- GET  /health                — terse legacy health (preserved for old clients)
- GET  /api/health            — deep health (scpi/dmm/chamber per-device,
                                 plus legacy scpi_reachable, disk_free, uptime)
- WS   /ws/live               — legacy demo telemetry (preserved)
- WS   /ws/telemetry          — production telemetry, 5 s heartbeat, demo-aware
- POST /api/scpi              — synchronous SCPI passthrough (logging only)
- POST /api/tests/{id}/control — stub control endpoint (start/pause/resume/...)
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from starlette.websockets import WebSocketState
from pydantic import BaseModel

try:
    # When this module is loaded via ``backend.main`` (the canonical import
    # path used by uvicorn / ``python -m backend``), the package is set
    # and we can use a relative import. When the file is executed as a
    # plain script (legacy ``python main.py``), the relative import fails
    # and we fall back to absolute lookup.
    from .config import get_settings
    from .gct_router import router as gct_router, ws_router as gct_ws_router
    from .iv.psu_scope import router as iv_psu_scope_router, ws_router as iv_psu_scope_ws_router
    from .scheduler_api import router as scheduler_router
    from .scpi_async import ScpiClient, is_scpi_reachable, run_telemetry_loop
    from .api.scpi_routes import router as scpi_router
    from .api.reports_routes import router as reports_router
    from .app.devices_api import router as devices_router
    from .app.health import start_background_health, stop_background_health
    from .db.backfill import backfill_csv_runs
    from .db.session import init_db
    from .tickets import router as tickets_router
except ImportError:  # pragma: no cover - script-mode fallback
    from config import get_settings  # type: ignore[no-redef]
    from gct_router import router as gct_router, ws_router as gct_ws_router  # type: ignore[no-redef]
    from iv.psu_scope import router as iv_psu_scope_router, ws_router as iv_psu_scope_ws_router  # type: ignore[no-redef]
    from scheduler_api import router as scheduler_router  # type: ignore[no-redef]
    from scpi_async import ScpiClient, is_scpi_reachable, run_telemetry_loop  # type: ignore[no-redef]
    from api.scpi_routes import router as scpi_router  # type: ignore[no-redef]
    from api.reports_routes import router as reports_router  # type: ignore[no-redef]
    from app.devices_api import router as devices_router  # type: ignore[no-redef]
    from app.health import start_background_health, stop_background_health  # type: ignore[no-redef]
    from db.backfill import backfill_csv_runs  # type: ignore[no-redef]
    from db.session import init_db  # type: ignore[no-redef]
    from tickets import router as tickets_router  # type: ignore[no-redef]


# --------------------------------------------------------------------------
# Logging — loguru if available, std logging otherwise.
# --------------------------------------------------------------------------
def _init_logging() -> None:
    s = get_settings()
    log_dir = Path(s.LOG_DIR)
    log_dir.mkdir(parents=True, exist_ok=True)
    try:
        from loguru import logger
        logger.remove()
        logger.add(
            log_dir / "backend.{time:YYYY-MM-DD}.log",
            rotation="10 MB",
            retention="14 days",
            enqueue=True,
            level=s.LOG_LEVEL,
            backtrace=True,
            diagnose=False,
        )
        logger.add(
            lambda m: print(m, end=""),
            level=s.LOG_LEVEL,
        )
    except ImportError:  # pragma: no cover
        import logging
        logging.basicConfig(level=s.LOG_LEVEL)


_init_logging()


_settings = get_settings()
_started_at = time.time()


async def _startup_backfill() -> None:
    """Mirror existing CSV runs into the DB. Best-effort: failures do not
    block the app since the CSV write path is the source of truth."""
    s = _settings
    try:
        init_db(s.DATABASE_URL)
    except Exception as exc:  # pragma: no cover - logged for ops
        try:
            from loguru import logger
            logger.warning("db init failed: {}", exc)
        except ImportError:
            import logging
            logging.getLogger(__name__).warning("db init failed: %s", exc)
        return
    if not s.DB_BACKFILL_ON_STARTUP:
        return
    try:
        inserted = await asyncio.get_event_loop().run_in_executor(
            None, backfill_csv_runs, s.CSV_RUNS_DIR
        )
        try:
            from loguru import logger
            logger.info("csv backfill: {} new test_run rows", inserted)
        except ImportError:
            import logging
            logging.getLogger(__name__).info("csv backfill: %d new test_run rows", inserted)
    except Exception as exc:  # pragma: no cover - logged for ops
        try:
            from loguru import logger
            logger.warning("csv backfill failed: {}", exc)
        except ImportError:
            import logging
            logging.getLogger(__name__).warning("csv backfill failed: %s", exc)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    # DB backfill first (idempotent CSV → SQLite mirror), then start the
    # background device-health probe; tear down health on shutdown.
    await _startup_backfill()
    start_background_health()
    try:
        yield
    finally:
        await stop_background_health()


app = FastAPI(
    title=_settings.APP_NAME,
    version=_settings.APP_VERSION,
    lifespan=_lifespan,
)
app.include_router(devices_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(tickets_router)

try:
    from .app.reliability import reliability_router
    from .app.procurement import procurement_router
    from .iv import router as iv_router
except ImportError:  # pragma: no cover - script-mode fallback
    from app.reliability import reliability_router  # type: ignore[no-redef]
    from app.procurement import procurement_router  # type: ignore[no-redef]
    from iv import router as iv_router  # type: ignore[no-redef]

app.include_router(reliability_router)
app.include_router(procurement_router)
app.include_router(scheduler_router)
app.include_router(scpi_router)
app.include_router(reports_router)
app.include_router(gct_router)
app.include_router(gct_ws_router)
app.include_router(iv_router)
app.include_router(iv_psu_scope_router)
app.include_router(iv_psu_scope_ws_router)


# --------------------------------------------------------------------------
# Health
# --------------------------------------------------------------------------
@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "demo": _settings.DEMO_MODE, "version": _settings.APP_VERSION}


@app.get("/healthz")
async def healthz() -> dict:
    """Railway/k8s-style liveness probe — same payload as /health."""
    return {"status": "ok", "demo": _settings.DEMO_MODE, "version": _settings.APP_VERSION}


_ROLE_TO_HEALTH_KEY = {
    "dc_source": "scpi",
    "dmm":       "dmm",
    "chamber":   "chamber",
}
# Transports that can be cheaply TCP-probed for liveness without holding
# the device handle. USBTMC / RS232 need an actual transport call.
_NET_PROBEABLE_KINDS = {"scpi_tcp", "modbus_tcp", "raw_tcp"}


def _probe_one_device(host: str, port: int, timeout_ms: int) -> bool:
    """Sync TCP probe wrapper — called via run_in_executor."""
    return is_scpi_reachable(host, int(port), timeout_ms)


async def _device_status_map() -> dict[str, str]:
    """Returns {scpi: ok|fail, dmm: ok|fail, chamber: ok|fail} keyed by role.

    Demo mode (global or per-device) reports ok unconditionally. Live mode
    TCP-probes net-capable transports and falls back to the registry's
    background-health snapshot for USBTMC/RS232 devices.
    """
    try:
        from .app.devices import get_registry
    except ImportError:  # pragma: no cover
        from app.devices import get_registry  # type: ignore[no-redef]

    out = {"scpi": "fail", "dmm": "fail", "chamber": "fail"}
    loop = asyncio.get_event_loop()
    for d in get_registry().all():
        key = _ROLE_TO_HEALTH_KEY.get(d.role)
        if not key:
            continue
        if _settings.DEMO_MODE or d.demo:
            out[key] = "ok"
            continue
        if d.transport_kind in _NET_PROBEABLE_KINDS:
            host = d.transport_opts.get("host")
            port = d.transport_opts.get("port")
            if not host or not port:
                out[key] = "fail"
                continue
            reachable = await loop.run_in_executor(
                None, _probe_one_device, str(host), int(port), _settings.ITECH_TIMEOUT_MS,
            )
            out[key] = "ok" if reachable else "fail"
        else:
            # No cheap sync probe — rely on the background loop's snapshot.
            out[key] = "ok" if bool(d.health.get("alive")) else "fail"
    return out


@app.get("/api/health")
async def deep_health() -> dict:
    """Deep health: probes SCPI port + disk + uptime + per-device status."""
    # SCPI reachability — probe on a thread so we never block the loop.
    scpi_reachable = await asyncio.get_event_loop().run_in_executor(
        None,
        is_scpi_reachable,
        _settings.ITECH_IP,
        _settings.ITECH_PORT,
        _settings.ITECH_TIMEOUT_MS,
    )
    try:
        free_bytes = shutil.disk_usage(os.getcwd()).free
        disk_free_mb = int(free_bytes / (1024 * 1024))
    except OSError:
        disk_free_mb = -1
    devices = await _device_status_map()
    overall = "ok"
    if not _settings.DEMO_MODE and any(v == "fail" for v in devices.values()):
        overall = "degraded"
    return {
        "status": overall,
        "demo": _settings.DEMO_MODE,
        "mode": "demo" if _settings.DEMO_MODE else "live",
        "version": _settings.APP_VERSION,
        "scpi_reachable": scpi_reachable,
        "scpi_target": f"{_settings.ITECH_IP}:{_settings.ITECH_PORT}",
        "disk_free_mb": disk_free_mb,
        "uptime_s": int(time.time() - _started_at),
        **devices,
    }


# --------------------------------------------------------------------------
# Telemetry WebSocket — preferred endpoint, 5 s heartbeat.
# --------------------------------------------------------------------------
HEARTBEAT_S = 5.0


def _ws_connected(ws: WebSocket) -> bool:
    """True only while both directions of the socket are still open."""
    return (
        ws.application_state == WebSocketState.CONNECTED
        and ws.client_state == WebSocketState.CONNECTED
    )


async def _safe_send(ws: WebSocket, stop_evt: asyncio.Event, text: str) -> bool:
    """Send ``text`` unless the peer has already gone away.

    Returns ``False`` and trips ``stop_evt`` when the socket is closing or
    closed, swallowing the ASGI ``websocket.send`` "after close" RuntimeError
    (and WebSocketDisconnect) that otherwise escapes the telemetry tasks and
    spams the uvicorn log on every client reconnect (Issues #100/#98).
    Callers must stop sending once this returns ``False``.
    """
    if stop_evt.is_set() or not _ws_connected(ws):
        stop_evt.set()
        return False
    try:
        await ws.send_text(text)
        return True
    except (RuntimeError, WebSocketDisconnect):
        stop_evt.set()
        return False


@app.websocket("/ws/telemetry")
async def websocket_telemetry(ws: WebSocket) -> None:
    await ws.accept()
    client = ScpiClient(demo_mode=_settings.DEMO_MODE)
    await client.connect()
    test_id = ws.query_params.get("test_id", "default")
    mqt = ws.query_params.get("mqt", "MQT11")
    interval = float(ws.query_params.get("interval", "0.5"))

    last_hb = time.monotonic()
    stop_evt = asyncio.Event()

    async def send_reading(payload: dict) -> None:
        await _safe_send(ws, stop_evt, json.dumps(payload))

    async def producer() -> None:
        try:
            await run_telemetry_loop(
                client, send_reading,
                test_id=test_id, mqt=mqt, interval_s=interval,
            )
        except asyncio.CancelledError:
            pass

    async def heartbeat() -> None:
        nonlocal last_hb
        while not stop_evt.is_set():
            await asyncio.sleep(HEARTBEAT_S)
            if not await _safe_send(
                ws, stop_evt, json.dumps({"type": "hb", "ts": int(time.time() * 1000)})
            ):
                return
            last_hb = time.monotonic()

    async def consumer() -> None:
        try:
            while not stop_evt.is_set():
                raw = await ws.receive_text()
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if msg.get("type") == "scpi" and isinstance(msg.get("command"), str):
                    await client.enqueue(msg["command"])
                elif msg.get("type") == "ping":
                    await _safe_send(ws, stop_evt, json.dumps({"type": "pong", "ts": int(time.time() * 1000)}))
        except WebSocketDisconnect:
            stop_evt.set()
        except Exception:
            stop_evt.set()

    prod_task = asyncio.create_task(producer())
    hb_task = asyncio.create_task(heartbeat())
    cons_task = asyncio.create_task(consumer())

    try:
        await stop_evt.wait()
    finally:
        for t in (prod_task, hb_task, cons_task):
            t.cancel()
        await asyncio.gather(prod_task, hb_task, cons_task, return_exceptions=True)
        await client.close()


# --------------------------------------------------------------------------
# Legacy /ws/live preserved for backwards compat (used by older clients).
# --------------------------------------------------------------------------
@app.websocket("/ws/live")
async def websocket_live(ws: WebSocket) -> None:
    await ws.accept()
    client = ScpiClient(demo_mode=_settings.DEMO_MODE)
    await client.connect()
    stop_evt = asyncio.Event()

    async def send_reading(payload: dict) -> None:
        await _safe_send(ws, stop_evt, json.dumps(payload))

    async def producer() -> None:
        try:
            await run_telemetry_loop(client, send_reading, mqt="MQT11", interval_s=0.5)
        except asyncio.CancelledError:
            pass

    async def consumer() -> None:
        try:
            while not stop_evt.is_set():
                raw = await ws.receive_text()
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if msg.get("type") == "scpi":
                    await client.enqueue(msg.get("command", ""))
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
        await client.close()


# --------------------------------------------------------------------------
# HTTP control plane
# --------------------------------------------------------------------------
class SCPICommand(BaseModel):
    command: str


@app.post("/api/scpi")
async def send_scpi(cmd: SCPICommand) -> dict:
    client = ScpiClient(demo_mode=_settings.DEMO_MODE)
    await client.connect()
    try:
        await client.send(cmd.command)
        return {"sent": cmd.command, "demo": _settings.DEMO_MODE}
    finally:
        await client.close()


class ControlAction(BaseModel):
    action: str


_ALLOWED_ACTIONS = {"start", "pause", "resume", "stop", "emergency_stop"}


@app.post("/api/tests/{test_id}/control")
async def test_control(test_id: str, body: ControlAction) -> dict:
    if body.action not in _ALLOWED_ACTIONS:
        return {"error": "invalid_action", "test_id": test_id, "accepted": False}
    return {"test_id": test_id, "action": body.action, "accepted": True, "demo": _settings.DEMO_MODE}


if __name__ == "__main__":  # pragma: no cover
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
