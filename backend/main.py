"""FastAPI backend for Agnipariksha PV test station.

Provides:
  * Device REST: status / connect / estop (<50 ms target)
  * Test REST:  start / stop / results / sessions
  * Reports:    word / pdf download
  * WebSocket:  /ws/live streams {ts,v,i,p,step,test_id,session_id} @ 10 Hz

In DEMO_MODE (default true) live readings come from `demo.py`. In live mode
the SCPI stub (and eventually the real driver provided by another branch)
takes over. The tests orchestrator is also a stub here; the wire protocol
is preserved so a real implementation can drop in without API changes.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db import (
    Event,
    Measurement,
    TestSession as DbSession,
    create_session,
    finalize_session,
    get_db,
    init_db,
    insert_measurement,
    log_event,
    session_scope,
)
from demo import evaluate_pass_fail, get_generator
from orchestrator_stub import STANDARDS, orchestrator
from reports import generate_pdf, generate_word
from scpi_stub import scpi


# ---------------------------------------------------------------------------
# Configuration & app
# ---------------------------------------------------------------------------

DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"
WS_HZ = float(os.getenv("AGNI_WS_HZ", "10"))
WS_INTERVAL = 1.0 / WS_HZ

VALID_TEST_IDS = {"tc", "hf", "letid", "bdt", "rco", "gct"}

logger = logging.getLogger("agnipariksha")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

@asynccontextmanager
async def _lifespan(_app: FastAPI):
    init_db()
    logger.info("DB initialised; DEMO_MODE=%s WS_HZ=%s", DEMO_MODE, WS_HZ)
    yield


app = FastAPI(title="Agnipariksha Backend", version="1.0.0", lifespan=_lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:1420"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class ConnectRequest(BaseModel):
    ip: Optional[str] = None
    port: Optional[int] = None


class StartTestRequest(BaseModel):
    module_id: Optional[str] = Field(default=None, description="DUT identifier")
    params: dict = Field(default_factory=dict, description="Test parameters (isc, imp, fuse, etc.)")


# ---------------------------------------------------------------------------
# Health / device endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict:
    return {"status": "ok", "demo": DEMO_MODE, "version": "1.0.0"}


@app.get("/api/device/status")
def device_status() -> dict:
    s = scpi.status()
    s["demo"] = DEMO_MODE
    s["running_tests"] = list(orchestrator.running_tests().keys())
    return s


@app.post("/api/device/connect")
def device_connect(req: ConnectRequest, db: Session = Depends(get_db)) -> dict:
    res = scpi.connect(req.ip, req.port)
    log_event(db, kind="info", message=f"connect {res}")
    return res


@app.post("/api/device/estop")
def device_estop(db: Session = Depends(get_db)) -> dict:
    """Emergency stop. Stops all running tests and turns output off.

    Latency target: < 50 ms. The hard work runs in SCPI driver; we
    also flip orchestrator state so any in-flight stream halts.
    """
    t0 = time.perf_counter()
    res = scpi.estop()
    orchestrator.stop_all()
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    log_event(db, kind="estop", message="E-STOP triggered", payload={"latency_ms": elapsed_ms})
    res["total_latency_ms"] = round(elapsed_ms, 3)
    return res


# ---------------------------------------------------------------------------
# Test lifecycle endpoints
# ---------------------------------------------------------------------------

def _validate_test_id(test_id: str) -> str:
    tid = test_id.lower()
    if tid not in VALID_TEST_IDS:
        raise HTTPException(
            status_code=400,
            detail=f"unknown test_id '{test_id}'; expected one of {sorted(VALID_TEST_IDS)}",
        )
    return tid


@app.post("/api/tests/{test_id}/start")
def start_test(
    test_id: str,
    req: StartTestRequest,
    db: Session = Depends(get_db),
) -> dict:
    tid = _validate_test_id(test_id)
    if orchestrator.is_running(tid):
        raise HTTPException(status_code=409, detail=f"test {tid} already running")
    sess = create_session(
        db,
        test_id=tid,
        standard=STANDARDS.get(tid),
        module_id=req.module_id,
        params=req.params,
    )
    orchestrator.start(tid, sess.id, req.params)
    log_event(db, kind="start", message=f"test {tid} started", session_id=sess.id)
    return {"session_id": sess.id, "test_id": tid, "started_at": sess.started_at.isoformat()}


@app.post("/api/tests/{test_id}/stop")
def stop_test(test_id: str, db: Session = Depends(get_db)) -> dict:
    tid = _validate_test_id(test_id)
    st = orchestrator.get_state(tid)
    if not st or not st.session_id:
        raise HTTPException(status_code=404, detail=f"no active session for {tid}")
    orchestrator.stop(tid)

    rows = (
        db.query(Measurement)
        .filter(Measurement.session_id == st.session_id)
        .order_by(Measurement.ts.asc())
        .all()
    )
    payload = [
        {
            "v": r.v,
            "i": r.i,
            "p": r.p,
            "extra": json.loads(r.extra_json) if r.extra_json else {},
        }
        for r in rows
    ]
    result = evaluate_pass_fail(tid, payload)
    status = (
        "passed" if result.get("verdict") == "PASS"
        else "failed" if result.get("verdict") == "FAIL"
        else "stopped"
    )
    finalize_session(db, st.session_id, status=status, result=result)
    log_event(db, kind="stop", message=f"test {tid} stopped", session_id=st.session_id, payload=result)
    return {"session_id": st.session_id, "status": status, "result": result}


@app.get("/api/tests/{test_id}/results")
def get_latest_test_results(test_id: str, db: Session = Depends(get_db)) -> dict:
    tid = _validate_test_id(test_id)
    sess = (
        db.query(DbSession)
        .filter(DbSession.test_id == tid)
        .order_by(DbSession.started_at.desc())
        .first()
    )
    if not sess:
        raise HTTPException(status_code=404, detail=f"no sessions for {tid}")
    rows = (
        db.query(Measurement)
        .filter(Measurement.session_id == sess.id)
        .order_by(Measurement.ts.asc())
        .all()
    )
    return {
        "session": sess.to_dict(),
        "measurement_count": len(rows),
        "preview": [
            {"ts": r.ts.isoformat(), "v": r.v, "i": r.i, "p": r.p, "step": r.step}
            for r in rows[: min(50, len(rows))]
        ],
    }


# ---------------------------------------------------------------------------
# Session endpoints
# ---------------------------------------------------------------------------

@app.get("/api/sessions")
def list_sessions(
    test_id: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
) -> dict:
    q = db.query(DbSession)
    if test_id:
        q = q.filter(DbSession.test_id == _validate_test_id(test_id))
    rows = q.order_by(DbSession.started_at.desc()).limit(limit).all()
    return {"items": [r.to_dict() for r in rows], "count": len(rows)}


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str, db: Session = Depends(get_db)) -> dict:
    s = db.get(DbSession, session_id)
    if not s:
        raise HTTPException(status_code=404, detail="session not found")
    m_count = db.query(Measurement).filter(Measurement.session_id == session_id).count()
    e_count = db.query(Event).filter(Event.session_id == session_id).count()
    return {**s.to_dict(), "measurement_count": m_count, "event_count": e_count}


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

@app.get("/api/reports/{session_id}/word")
def report_word(session_id: str, db: Session = Depends(get_db)) -> FileResponse:
    s = db.get(DbSession, session_id)
    if not s:
        raise HTTPException(status_code=404, detail="session not found")
    try:
        path = generate_word(db, session_id)
    except Exception as exc:
        logger.exception("Word report failed")
        raise HTTPException(status_code=500, detail=str(exc))
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=os.path.basename(path),
    )


@app.get("/api/reports/{session_id}/pdf")
def report_pdf(session_id: str, db: Session = Depends(get_db)) -> FileResponse:
    s = db.get(DbSession, session_id)
    if not s:
        raise HTTPException(status_code=404, detail="session not found")
    try:
        path = generate_pdf(db, session_id)
    except Exception as exc:
        logger.exception("PDF report failed")
        raise HTTPException(status_code=500, detail=str(exc))
    return FileResponse(path, media_type="application/pdf", filename=os.path.basename(path))


# ---------------------------------------------------------------------------
# WebSocket /ws/live
# ---------------------------------------------------------------------------

@app.websocket("/ws/live")
async def ws_live(ws: WebSocket) -> None:
    """Stream live readings at 10 Hz.

    Payload schema: {ts, v, i, p, step, test_id, session_id, extra}
    When no test is running we still emit idle frames so the UI can show
    connectivity. The first running test (by insertion order) drives the
    stream; multiplexing multiple concurrent tests is future orchestrator work.
    """
    await ws.accept()
    logger.info("WS client connected")
    persist_every = max(1, int(WS_HZ))  # ≈ once per second
    tick = 0
    try:
        while True:
            t_loop_start = time.perf_counter()
            running = orchestrator.running_tests()
            if running:
                test_id, state = next(iter(running.items()))
                elapsed = time.time() - (state.started_at or time.time())
                gen = get_generator(test_id)
                r = gen(elapsed, state.params)
                payload = {
                    "ts": datetime.utcnow().isoformat() + "Z",
                    "v": round(r.v, 4),
                    "i": round(r.i, 4),
                    "p": round(r.p, 4),
                    "step": r.step,
                    "test_id": test_id,
                    "session_id": state.session_id,
                    "extra": r.extra,
                }
                if tick % persist_every == 0 and state.session_id:
                    # Downsample persistence to ~1 Hz; full 10 Hz would bloat SQLite.
                    try:
                        with session_scope() as db:
                            insert_measurement(
                                db,
                                session_id=state.session_id,
                                v=r.v,
                                i=r.i,
                                p=r.p,
                                step=r.step,
                                extra=r.extra,
                            )
                    except Exception:
                        logger.exception("persist measurement failed")
            else:
                payload = {
                    "ts": datetime.utcnow().isoformat() + "Z",
                    "v": None,
                    "i": None,
                    "p": None,
                    "step": None,
                    "test_id": None,
                    "session_id": None,
                    "extra": {"idle": True},
                }

            await ws.send_text(json.dumps(payload))
            tick += 1

            sleep_for = WS_INTERVAL - (time.perf_counter() - t_loop_start)
            if sleep_for > 0:
                await asyncio.sleep(sleep_for)
    except WebSocketDisconnect:
        logger.info("WS client disconnected")
    except Exception:
        logger.exception("WS error")
        try:
            await ws.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("AGNI_HOST", "0.0.0.0"),
        port=int(os.getenv("AGNI_PORT", "8000")),
        reload=False,
    )
