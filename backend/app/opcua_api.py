"""REST proxy for the in-app OPC UA PSU dashboard.

Surfaces the same PSU state the OPC UA server exposes, over plain HTTP, so the
web/standalone frontend can mirror telemetry and command setpoints without
speaking OPC UA in the browser. The OPC UA address space stays the single
source of truth: this reads/writes its nodes via ``PsuOpcUaServer`` and
advances the DEMO bridge on each poll.
"""
from __future__ import annotations

import asyncio
from typing import List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .opcua_bridge import DemoPsuSource, PsuOpcUaBridge
from .opcua_server import WRITABLE_NODES, PsuOpcUaServer, PsuSetpoints

router = APIRouter(prefix="/api/opcua", tags=["opcua"])

_server: Optional[PsuOpcUaServer] = None
_bridge: Optional[PsuOpcUaBridge] = None
_lock = asyncio.Lock()


async def _get_bridge() -> PsuOpcUaBridge:
    """Lazily build a DEMO server (address space only, no socket) + bridge."""
    global _server, _bridge
    if _bridge is None:
        async with _lock:
            if _bridge is None:
                server = PsuOpcUaServer(mode="DEMO")
                await server.init()
                _server = server
                _bridge = PsuOpcUaBridge(server, DemoPsuSource())
    return _bridge


def reset() -> None:
    """Drop the singletons (test isolation). No socket is bound, so safe."""
    global _server, _bridge
    _server = None
    _bridge = None


class SetpointsIn(BaseModel):
    voltage_v: float = Field(ge=0, le=1000)
    current_a: float = Field(ge=0, le=100)
    output_enabled: bool = False


class PsuStateOut(BaseModel):
    voltage_v: float
    current_a: float
    power_w: float
    temperature_c: float
    model: str
    mode: str
    writable_nodes: List[str]


@router.get("/psu", response_model=PsuStateOut)
async def get_psu() -> PsuStateOut:
    bridge = await _get_bridge()
    await bridge.tick()  # advance the DEMO sim + publish to the nodes
    assert _server is not None
    return PsuStateOut(
        voltage_v=await _server.nodes_value("Voltage_V"),
        current_a=await _server.nodes_value("Current_A"),
        power_w=await _server.nodes_value("Power_W"),
        temperature_c=await _server.nodes_value("Temperature_C"),
        model=await _server.nodes_value("Model"),
        mode=await _server.nodes_value("Mode"),
        writable_nodes=list(WRITABLE_NODES),
    )


@router.post("/psu/setpoints", response_model=SetpointsIn)
async def post_setpoints(body: SetpointsIn) -> SetpointsIn:
    await _get_bridge()
    assert _server is not None
    await _server.set_setpoints(
        PsuSetpoints(
            voltage_v=body.voltage_v,
            current_a=body.current_a,
            output_enabled=body.output_enabled,
        )
    )
    return body
