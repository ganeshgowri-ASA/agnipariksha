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
    from .scpi_async import ScpiClient, is_scpi_reachable, run_telemetry_loop
except ImportError:  # pragma: no cover - script-mode fallback
    from config import get_settings  # type: ignore[no-redef]
    from scpi_async import ScpiClient, is_scpi_reachable, run_telemetry_loop  # type: ignore[no-redef]

try:
    from backend.app.tests.letid import LeTIDConfig
    from backend.app.tests.letid_runner import get_registry as get_letid_registry
except ImportError:  # pragma: no cover - script-mode fallback
    from app.tests.letid import LeTIDConfig  # type: ignore[no-redef]
    from app.tests.letid_runner import get_registry as get_letid_registry  # type: ignore[no-redef]


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


# --------------------------------------------------------------------------
# LeTID (IEC TS 63342) — start/stop, status, and event stream.
# --------------------------------------------------------------------------
class LeTIDStartRequest(BaseModel):
    isc_stc: float = 9.5
    impp_stc: float = 8.9
    vmpp_stc: float = 37.5
    voc_stc: float = 45.0
    pmpp_stc: float = 0.0
    temperature_c: float = 75.0
    temperature_tolerance_c: float = 5.0
    injection_current_a: Optional[float] = None
    total_duration_h: float = 162.0
    iv_interval_h: float = 24.0
    telemetry_interval_s: float = 5.0
    drift_alarm_pct: float = 0.5
    max_allowed_loss_pct: float = 2.0
    demo_mode: Optional[bool] = None

    def to_config(self) -> LeTIDConfig:
        pmpp = self.pmpp_stc if self.pmpp_stc > 0 else self.vmpp_stc * self.impp_stc
        return LeTIDConfig(
            isc_stc=self.isc_stc,
            impp_stc=self.impp_stc,
            vmpp_stc=self.vmpp_stc,
            voc_stc=self.voc_stc,
            pmpp_stc=pmpp,
            temperature_c=self.temperature_c,
            temperature_tolerance_c=self.temperature_tolerance_c,
            injection_current_a=self.injection_current_a,
            total_duration_h=self.total_duration_h,
            iv_interval_h=self.iv_interval_h,
            telemetry_interval_s=self.telemetry_interval_s,
            drift_alarm_pct=self.drift_alarm_pct,
            max_allowed_loss_pct=self.max_allowed_loss_pct,
        )


@app.post("/api/tests/letid/start")
async def letid_start(req: LeTIDStartRequest) -> dict:
    reg = get_letid_registry()
    sid = await reg.start(req.to_config(), demo_mode=req.demo_mode)
    return {"session_id": sid, "started": True}


@app.post("/api/tests/letid/{session_id}/stop")
async def letid_stop(session_id: str) -> dict:
    reg = get_letid_registry()
    result = await reg.stop(session_id)
    if result is None:
        return {"session_id": session_id, "stopped": False, "error": "unknown_session"}
    return {"session_id": session_id, "stopped": True, "summary": result.summary()}


@app.post("/api/tests/letid/{session_id}/pause")
async def letid_pause(session_id: str) -> dict:
    ok = get_letid_registry().pause(session_id)
    return {"session_id": session_id, "paused": ok}


@app.post("/api/tests/letid/{session_id}/resume")
async def letid_resume(session_id: str) -> dict:
    ok = get_letid_registry().resume(session_id)
    return {"session_id": session_id, "resumed": ok}


@app.get("/api/tests/letid")
async def letid_list_sessions() -> dict:
    return {"sessions": get_letid_registry().list_sessions()}


@app.get("/api/tests/letid/{session_id}")
async def letid_get_session(session_id: str) -> dict:
    entry = get_letid_registry().get(session_id)
    if entry is None:
        return {"session_id": session_id, "error": "unknown_session"}
    o = entry.orchestrator
    return {
        "session_id": session_id,
        "running": o.running,
        "summary": o.result.summary(),
        "history": entry.history[-512:],
    }


@app.websocket("/ws/letid/{session_id}")
async def letid_events(ws: WebSocket, session_id: str) -> None:
    await ws.accept()
    entry = get_letid_registry().get(session_id)
    if entry is None:
        await ws.send_text(json.dumps({"type": "error", "error": "unknown_session"}))
        await ws.close()
        return
    q: asyncio.Queue[dict] = asyncio.Queue(maxsize=1024)
    entry.subscribers.add(q)
    try:
        # Replay recent events so a late subscriber sees the curve so far.
        for ev in entry.history[-256:]:
            await ws.send_text(json.dumps(ev))
        while True:
            ev = await q.get()
            await ws.send_text(json.dumps(ev))
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        entry.subscribers.discard(q)


if __name__ == "__main__":  # pragma: no cover
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
