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

from fastapi import Depends, FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    # When this module is loaded via ``backend.main`` (the canonical import
    # path used by uvicorn / ``python -m backend``), the package is set
    # and we can use a relative import. When the file is executed as a
    # plain script (legacy ``python main.py``), the relative import fails
    # and we fall back to absolute lookup.
    from .auth import mint_dev_token, require_user, require_ws
    from .config import get_settings
    from .events import get_bus, publish_event
    from .labels import router as labels_router
    from .push import router as push_router
    from .scpi_async import ScpiClient, is_scpi_reachable, run_telemetry_loop
except ImportError:  # pragma: no cover - script-mode fallback
    from auth import mint_dev_token, require_user, require_ws  # type: ignore[no-redef]
    from config import get_settings  # type: ignore[no-redef]
    from events import get_bus, publish_event  # type: ignore[no-redef]
    from labels import router as labels_router  # type: ignore[no-redef]
    from push import router as push_router  # type: ignore[no-redef]
    from scpi_async import ScpiClient, is_scpi_reachable, run_telemetry_loop  # type: ignore[no-redef]


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


@asynccontextmanager
async def _lifespan(app: FastAPI):
    yield


app = FastAPI(
    title=_settings.APP_NAME,
    version=_settings.APP_VERSION,
    lifespan=_lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# Feature routers — labels (printable QR PDFs) + web push (VAPID).
app.include_router(labels_router)
app.include_router(push_router)


@app.get("/api/auth/dev-token")
def dev_token() -> dict:
    """Mint a dev JWT for local testing. No-op when AUTH_ENABLED=False."""
    if not _settings.AUTH_ENABLED:
        return {"token": "", "auth_enabled": False}
    return {"token": mint_dev_token(), "auth_enabled": True}


# --------------------------------------------------------------------------
# Health
# --------------------------------------------------------------------------
@app.get("/health")
async def health() -> dict:
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
    if await require_ws(ws) is None:
        return
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
    if await require_ws(ws) is None:
        return
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
async def send_scpi(cmd: SCPICommand, _user=Depends(require_user)) -> dict:
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
async def test_control(test_id: str, body: ControlAction, _user=Depends(require_user)) -> dict:
    if body.action not in _ALLOWED_ACTIONS:
        return {"error": "invalid_action", "test_id": test_id, "accepted": False}
    # Broadcast to /ws/events subscribers so remote dashboards update live.
    await publish_event(
        "state",
        {"test_id": test_id, "action": body.action, "demo": _settings.DEMO_MODE},
    )
    return {"test_id": test_id, "action": body.action, "accepted": True, "demo": _settings.DEMO_MODE}


# --------------------------------------------------------------------------
# Remote-monitoring WebSocket — state / alarms / tickets fan-out.
# --------------------------------------------------------------------------
@app.websocket("/ws/events")
async def websocket_events(ws: WebSocket) -> None:
    if await require_ws(ws) is None:
        return
    await ws.accept()
    bus = get_bus()
    q = await bus.subscribe()
    # Greet so clients can detect "connected" without waiting for an event.
    await ws.send_text(json.dumps({"type": "hello", "ts": int(time.time() * 1000)}))
    stop_evt = asyncio.Event()

    async def reader() -> None:
        try:
            while not stop_evt.is_set():
                raw = await ws.receive_text()
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if msg.get("type") == "ping":
                    await ws.send_text(
                        json.dumps({"type": "pong", "ts": int(time.time() * 1000)})
                    )
                elif msg.get("type") in {"alarm", "ticket", "state"}:
                    # Clients (e.g. tablets) can also raise alarms/tickets.
                    await bus.publish({"type": msg["type"], "data": msg.get("data", {})})
        except WebSocketDisconnect:
            stop_evt.set()
        except Exception:
            stop_evt.set()

    async def writer() -> None:
        try:
            while not stop_evt.is_set():
                evt = await q.get()
                await ws.send_text(json.dumps(evt))
        except Exception:
            stop_evt.set()

    r = asyncio.create_task(reader())
    w = asyncio.create_task(writer())
    try:
        await stop_evt.wait()
    finally:
        for t in (r, w):
            t.cancel()
        await asyncio.gather(r, w, return_exceptions=True)
        await bus.unsubscribe(q)


class AlarmPayload(BaseModel):
    severity: str = "info"
    message: str
    source: str = "operator"


@app.post("/api/events/alarm")
async def post_alarm(body: AlarmPayload, _user=Depends(require_user)) -> dict:
    await publish_event("alarm", body.model_dump())
    return {"ok": True}


class TicketPayload(BaseModel):
    title: str
    severity: str = "normal"
    description: str = ""
    assignee: str | None = None


@app.post("/api/events/ticket")
async def post_ticket(body: TicketPayload, _user=Depends(require_user)) -> dict:
    await publish_event("ticket", body.model_dump())
    return {"ok": True}


if __name__ == "__main__":  # pragma: no cover
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
