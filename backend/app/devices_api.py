"""REST router for the device registry.

Exposed under ``/api/devices``:
* GET    /                 — full registry with health snapshots
* GET    /{id}             — single device
* POST   /{id}/mode        — toggle demo/live
* POST   /{id}/ping        — force an immediate liveness probe
* GET    /audit            — tail of the transport audit log
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .devices import get_registry
from .transports import get_audit_log


router = APIRouter(prefix="/api/devices", tags=["devices"])


class ModeBody(BaseModel):
    mode: str  # "demo" | "live"


@router.get("")
async def list_devices() -> dict:
    reg = get_registry()
    return {"devices": reg.to_list(), "count": len(reg)}


@router.get("/{device_id}")
async def get_device(device_id: str) -> dict:
    d = get_registry().get(device_id)
    if d is None:
        raise HTTPException(404, f"device {device_id!r} not found")
    return d.to_dict()


@router.post("/{device_id}/mode")
async def set_mode(device_id: str, body: ModeBody) -> dict:
    d = get_registry().get(device_id)
    if d is None:
        raise HTTPException(404, f"device {device_id!r} not found")
    mode = body.mode.strip().lower()
    if mode not in ("demo", "live"):
        raise HTTPException(400, "mode must be 'demo' or 'live'")
    d.demo = (mode == "demo")
    d.get_transport().set_demo(d.demo)
    return {"id": d.id, "demo": d.demo, "mode": mode}


@router.post("/{device_id}/ping")
async def ping_device(device_id: str) -> dict:
    d = get_registry().get(device_id)
    if d is None:
        raise HTTPException(404, f"device {device_id!r} not found")
    transport = d.get_transport()
    if transport.state.value in ("init", "closed", "down") and not d.demo:
        await transport.connect(max_attempts=1)
    alive = await transport.is_alive()
    d.health = {
        "alive": alive,
        "state": transport.state.value,
        "last_error": transport.last_error,
        "last_alive_ms": transport.last_alive_ms,
    }
    return {"id": d.id, "alive": alive, "state": transport.state.value}


@router.get("/audit/tail")
async def audit_tail(n: int = 100, device_id: Optional[str] = None) -> dict:
    entries = get_audit_log().tail(n=n, device_id=device_id)
    return {"entries": [e.to_dict() for e in entries], "count": len(entries)}
