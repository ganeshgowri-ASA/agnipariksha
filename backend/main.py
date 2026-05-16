"""FastAPI backend for Agnipariksha PV test station.

Endpoints
---------
- GET  /health                — terse legacy health (preserved for old clients)
- GET  /api/health            — deep health (scpi_reachable, disk_free, uptime)
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
from pydantic import BaseModel

try:
    # When this module is loaded via ``backend.main`` (the canonical import
    # path used by uvicorn / ``python -m backend``), the package is set
    # and we can use a relative import. When the file is executed as a
    # plain script (legacy ``python main.py``), the relative import fails
    # and we fall back to absolute lookup.
    from .config import get_settings
    from .scheduler_api import router as scheduler_router
    from .scpi_async import ScpiClient, is_scpi_reachable, run_telemetry_loop
    from .scpi_router import router as scpi_router
    from .app.devices_api import router as devices_router
    from .app.health import start_background_health, stop_background_health
    from .db.backfill import backfill_csv_runs
    from .db.session import init_db
    from .tickets import router as tickets_router
except ImportError:  # pragma: no cover - script-mode fallback
    from config import get_settings  # type: ignore[no-redef]
    from scheduler_api import router as scheduler_router  # type: ignore[no-redef]
    from scpi_async import ScpiClient, is_scpi_reachable, run_telemetry_loop  # type: ignore[no-redef]
    from scpi_router import router as scpi_router  # type: ignore[no-redef]
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
except ImportError:  # pragma: no cover - script-mode fallback
    from app.reliability import reliability_router  # type: ignore[no-redef]
    from app.procurement import procurement_router  # type: ignore[no-redef]

app.include_router(reliability_router)
app.include_router(procurement_router)
app.include_router(scheduler_router)
app.include_router(scpi_router)


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


@app.get("/api/health")
async def deep_health() -> dict:
    """Deep health: probes SCPI port + disk + uptime."""
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
    overall = "ok"
    if not scpi_reachable and not _settings.DEMO_MODE:
        overall = "degraded"
    return {
        "status": overall,
        "demo": _settings.DEMO_MODE,
        "version": _settings.APP_VERSION,
        "scpi_reachable": scpi_reachable,
        "scpi_target": f"{_settings.ITECH_IP}:{_settings.ITECH_PORT}",
        "disk_free_mb": disk_free_mb,
        "uptime_s": int(time.time() - _started_at),
    }


# --------------------------------------------------------------------------
# Telemetry WebSocket — preferred endpoint, 5 s heartbeat.
# --------------------------------------------------------------------------
HEARTBEAT_S = 5.0


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
        await ws.send_text(json.dumps(payload))

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
            try:
                await ws.send_text(json.dumps({"type": "hb", "ts": int(time.time() * 1000)}))
                last_hb = time.monotonic()
            except Exception:
                stop_evt.set()
                return

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
                    await ws.send_text(json.dumps({"type": "pong", "ts": int(time.time() * 1000)}))
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
        await ws.send_text(json.dumps(payload))

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

    cons_task = asyncio.create_task(consumer())
    try:
        await run_telemetry_loop(client, send_reading, mqt="MQT11", interval_s=0.5)
    except asyncio.CancelledError:
        pass
    finally:
        stop_evt.set()
        cons_task.cancel()
        await asyncio.gather(cons_task, return_exceptions=True)
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
