"""PSU + Oscilloscope IV-curve acquisition mode.

Drives the ITECH PV6000 in voltage-ramp mode while an external DSO
(Keysight/Rigol) samples the shunt voltage on ``scope_channel``. With
the lab's 1 mΩ shunt, 4 mV across the shunt corresponds to 1 A through
the DUT; current is recovered as ``I = V_shunt / shunt_ohms``. Each
``{v, i, t}`` triple is pushed over a per-run WebSocket.

Safety
------
Every PSU ``OUTP`` / ``VOLT`` / ``CURR`` call is wrapped by
``_enforce_basic_check`` (lands in G1 #52 — until then the local stub
no-ops so demo + tests can exercise this path). The PSU OUTPUT itself
is **never** enabled by this module; the front-end / test orchestrator
must explicitly call ``_psu_output(client, True)`` after the Basic
Check gate has passed. Tests assert it stays OFF.

In DEMO_MODE we emit a single-diode synthetic sweep and never touch
the SCPI socket.
"""
from __future__ import annotations

import asyncio
import json
import math
import time
import uuid
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

try:
    from ..config import get_settings
    from ..scpi_async import ScpiClient, ScpiUnreachable
except ImportError:  # pragma: no cover - script-mode fallback
    from config import get_settings  # type: ignore[no-redef]
    from scpi_async import ScpiClient, ScpiUnreachable  # type: ignore[no-redef]

# G1 #52 introduces ``_enforce_basic_check`` in backend.scpi_async. Until
# that PR merges, fall back to a no-op so this module remains importable
# and demo + tests stay green. The real function raises on a closed gate;
# we deliberately do NOT swallow that here — callers see the exception.
try:  # pragma: no cover - cover branch flips on G1 #52 merge
    from ..scpi_async import _enforce_basic_check  # type: ignore[attr-defined]
except (ImportError, AttributeError):  # pragma: no cover
    try:
        from scpi_async import _enforce_basic_check  # type: ignore[attr-defined,no-redef]
    except (ImportError, AttributeError):
        async def _enforce_basic_check(_cmd: str) -> None:  # type: ignore[no-redef]
            """Stub: real check lands in G1 #52."""
            return None


router = APIRouter(prefix="/api/iv/psu-scope", tags=["iv"])
ws_router = APIRouter(tags=["iv"])


class PsuScopeStartReq(BaseModel):
    psu_ramp_rate_v_s: float = Field(1.0, gt=0, le=100.0)
    shunt_ohms: float = Field(0.001, gt=0, lt=1.0)
    scope_channel: int = Field(1, ge=1, le=4)
    scope_timebase_ms: float = Field(10.0, gt=0)
    scope_trigger_v: float = Field(0.0)
    sample_rate_hz: float = Field(1000.0, gt=0, le=100_000.0)
    sweeps: int = Field(1, ge=1, le=20)
    v_max: float = Field(50.0, gt=0, le=1500.0)


class PsuScopeStartResp(BaseModel):
    run_id: str
    demo: bool


@dataclass
class _Run:
    cfg: PsuScopeStartReq
    started_ms: int
    done: bool = False


_RUNS: dict[str, _Run] = {}


# ---------------------------------------------------------------------------
# Gated PSU helpers — every OUTP/VOLT/CURR routes through the basic-check.
# ---------------------------------------------------------------------------

async def _psu_set_voltage(client: ScpiClient, v: float) -> None:
    cmd = f"SOURce:VOLTage:LEVel:IMMediate {v:.4f}"
    await _enforce_basic_check(cmd)
    await client.send(cmd)


async def _psu_set_current(client: ScpiClient, i: float) -> None:
    cmd = f"SOURce:CURRent:LEVel:IMMediate {i:.4f}"
    await _enforce_basic_check(cmd)
    await client.send(cmd)


async def _psu_output(client: ScpiClient, on: bool) -> None:
    cmd = "OUTPut " + ("ON" if on else "OFF")
    await _enforce_basic_check(cmd)
    await client.send(cmd)


async def _scope_read_shunt_v(client: ScpiClient, ch: int) -> float:
    """Single-shot mean-voltage on a scope channel (Keysight/Rigol VAVG)."""
    raw = await client.query(f":MEAS:VAVG? CHAN{ch}")
    try:
        return float(raw)
    except (TypeError, ValueError):
        return 0.0


# ---------------------------------------------------------------------------
# Synthetic single-diode IV used by DEMO_MODE.
# ---------------------------------------------------------------------------

def _synthetic_iv(v: float, isc: float = 9.5, voc: float = 50.0, vt: float = 2.0) -> float:
    """Return I(V) on a normalised single-diode curve: I(0)≈Isc, I(Voc)=0."""
    return max(0.0, isc * (1.0 - math.exp((v - voc) / vt)))


def _step_v(v: float, ramp_v_s: float, dt: float) -> float:
    return v + ramp_v_s * dt


# ---------------------------------------------------------------------------
# HTTP — start a run, returning the run_id the WS will stream against.
# ---------------------------------------------------------------------------

@router.post("/start", response_model=PsuScopeStartResp)
async def start_psu_scope(req: PsuScopeStartReq) -> PsuScopeStartResp:
    run_id = uuid.uuid4().hex[:12]
    _RUNS[run_id] = _Run(cfg=req, started_ms=int(time.time() * 1000))
    return PsuScopeStartResp(run_id=run_id, demo=get_settings().DEMO_MODE)


# ---------------------------------------------------------------------------
# WebSocket — streams V/I pairs for the lifetime of one sweep set.
# ---------------------------------------------------------------------------

async def _emit(ws: WebSocket, payload: dict) -> bool:
    """Best-effort send; returns False if the peer is gone."""
    try:
        await ws.send_text(json.dumps(payload))
        return True
    except (WebSocketDisconnect, RuntimeError):
        return False


async def _stream_demo(ws: WebSocket, cfg: PsuScopeStartReq, period: float) -> None:
    t0 = time.monotonic()
    for sweep in range(cfg.sweeps):
        v = 0.0
        while v <= cfg.v_max:
            i = _synthetic_iv(v)
            ok = await _emit(ws, {
                "sweep": sweep,
                "t": round(time.monotonic() - t0, 4),
                "v": round(v, 4),
                "i": round(i, 4),
            })
            if not ok:
                return
            await asyncio.sleep(period)
            v = _step_v(v, cfg.psu_ramp_rate_v_s, period)
    await _emit(ws, {"done": True, "sweeps": cfg.sweeps})


async def _stream_live(
    ws: WebSocket, client: ScpiClient, cfg: PsuScopeStartReq, period: float,
) -> None:
    t0 = time.monotonic()
    # NB: we never call _psu_output(client, True) here. The Basic Check
    # gate front-end enables output explicitly once the operator has
    # acknowledged HV/arc-flash precautions; CI tests verify OUTP stays OFF.
    for sweep in range(cfg.sweeps):
        v = 0.0
        while v <= cfg.v_max:
            await _psu_set_voltage(client, v)
            v_shunt = await _scope_read_shunt_v(client, cfg.scope_channel)
            i = v_shunt / cfg.shunt_ohms
            ok = await _emit(ws, {
                "sweep": sweep,
                "t": round(time.monotonic() - t0, 4),
                "v": round(v, 4),
                "i": round(i, 4),
            })
            if not ok:
                return
            await asyncio.sleep(period)
            v = _step_v(v, cfg.psu_ramp_rate_v_s, period)
    await _emit(ws, {"done": True, "sweeps": cfg.sweeps})


@ws_router.websocket("/api/iv/psu-scope/stream/{run_id}")
async def stream_psu_scope(ws: WebSocket, run_id: str) -> None:
    await ws.accept()
    run = _RUNS.get(run_id)
    if run is None:
        await _emit(ws, {"error": "unknown_run_id", "run_id": run_id})
        await ws.close()
        return

    cfg = run.cfg
    period = 1.0 / cfg.sample_rate_hz
    demo = get_settings().DEMO_MODE

    if demo:
        await _stream_demo(ws, cfg, period)
    else:
        client = ScpiClient(demo_mode=False)
        try:
            await client.connect()
        except ScpiUnreachable as exc:
            await _emit(ws, {"error": "scpi_unreachable",
                             "host": exc.host, "port": exc.port,
                             "reason": exc.reason})
            await ws.close()
            return
        try:
            await _stream_live(ws, client, cfg, period)
        finally:
            # Best-effort safe-state on exit. Each gated helper short-
            # circuits cleanly if the basic-check gate has since closed.
            try:
                await _psu_set_voltage(client, 0.0)
                await _psu_output(client, False)
            except Exception:
                pass
            await client.close()

    run.done = True
    try:
        await ws.close()
    except Exception:
        pass
