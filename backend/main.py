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
    from .app.tests.thermal_cycling import (
        TCConfig,
        analyze as tc_analyze,
        make_demo_orchestrator,
    )
except ImportError:  # pragma: no cover - script-mode fallback
    from config import get_settings  # type: ignore[no-redef]
    from scpi_async import ScpiClient, is_scpi_reachable, run_telemetry_loop  # type: ignore[no-redef]
    from app.tests.thermal_cycling import (  # type: ignore[no-redef]
        TCConfig,
        analyze as tc_analyze,
        make_demo_orchestrator,
    )


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
# IEC 61215-2 MQT 11 — Thermal Cycling orchestrator endpoints
# --------------------------------------------------------------------------
class TCStartBody(BaseModel):
    cycles: int = 200
    t_hot_c: float = 85.0
    t_cold_c: float = -40.0
    ramp_rate_c_per_h: float = 100.0
    hot_dwell_s: int = 600
    cold_dwell_s: int = 600
    technology: str = "c-Si"
    imp_a: Optional[float] = None
    voc_v: float = 45.0
    pre_test_pmax_w: float = 400.0
    time_scale: float = 1.0
    sample_interval_s: float = 0.5


class TCAnalysisBody(BaseModel):
    post_pmax_w: float


_tc_sessions: dict = {}


@app.post("/api/tests/thermal-cycling/start")
async def tc_start(body: TCStartBody) -> dict:
    """Configure (but do not yet run) an IEC 61215-2 MQT 11 session.

    Streaming happens on ``/ws/tests/thermal-cycling`` using the session_id
    returned here. This split keeps the WS handler stateless.
    """
    try:
        cfg = TCConfig(**body.model_dump())
    except ValueError as exc:
        return {"error": "invalid_config", "detail": str(exc)}
    raw_dir = Path(_settings.LOG_DIR) / "thermal_cycling"
    raw_dir.mkdir(parents=True, exist_ok=True)
    orch = make_demo_orchestrator(cfg=cfg, raw_csv_path=raw_dir / "pending.csv")
    raw_path = raw_dir / f"{orch.session_id}.csv"
    orch._raw_csv_path = raw_path  # type: ignore[attr-defined]
    _tc_sessions[orch.session_id] = orch
    return {
        "session_id": orch.session_id,
        "config": body.model_dump(),
        "raw_csv_path": str(raw_path.resolve()),
        "standard": "IEC 61215-2 MQT 11",
        "clause": "4.11",
        "gate2_threshold_percent": -5.0,
    }


@app.post("/api/tests/thermal-cycling/{session_id}/stop")
async def tc_stop(session_id: str) -> dict:
    orch = _tc_sessions.get(session_id)
    if orch is None:
        return {"error": "unknown_session"}
    orch.abort()
    return {"session_id": session_id, "state": orch.state.value}


@app.post("/api/tests/thermal-cycling/{session_id}/analyze")
async def tc_analyze_endpoint(session_id: str, body: TCAnalysisBody) -> dict:
    orch = _tc_sessions.get(session_id)
    if orch is None:
        return {"error": "unknown_session"}
    result = tc_analyze(orch, post_pmax_w=body.post_pmax_w)
    return {
        **result.to_dict(),
        "iec_clause": "4.11",
        "standard": "IEC 61215-2 MQT 11",
        "cycle_log": [r.to_dict() for r in orch.cycle_log],
        "raw_csv_path": str(getattr(orch, "_raw_csv_path", "")),
    }


@app.websocket("/ws/tests/thermal-cycling")
async def ws_thermal_cycling(ws: WebSocket) -> None:
    """Streams the MQT 11 state machine to the live chart.

    Query params: session_id (required, from /start). Emits one
    JSON ``TCSample`` per orchestrator step plus a final ``summary``.
    """
    await ws.accept()
    session_id = ws.query_params.get("session_id", "")
    orch = _tc_sessions.get(session_id)
    if orch is None:
        await ws.send_text(json.dumps({"error": "unknown_session"}))
        await ws.close()
        return
    try:
        async for sample in orch.stream():
            await ws.send_text(json.dumps({"type": "sample", **sample.to_dict()}))
        await ws.send_text(json.dumps({
            "type": "summary",
            **orch.summary(),
            "cycle_log": [r.to_dict() for r in orch.cycle_log],
        }))
    except WebSocketDisconnect:
        orch.abort()
    finally:
        try:
            await ws.close()
        except Exception:
            pass


if __name__ == "__main__":  # pragma: no cover
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
