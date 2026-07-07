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

from .opcua_bridge import DemoPsuSource, PsuOpcUaBridge, PvArraySource
from .opcua_server import WRITABLE_NODES, PsuOpcUaServer, PsuSetpoints
from .pv_iv import PvModule, iv_curve, max_power_point

router = APIRouter(prefix="/api/opcua", tags=["opcua"])

_server: Optional[PsuOpcUaServer] = None
_bridge: Optional[PsuOpcUaBridge] = None
_mode: str = "psu"  # "psu" (bench supply) | "pv" (PV array simulator)
_pv = PvArraySource()
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
                source = _pv if _mode == "pv" else DemoPsuSource()
                _bridge = PsuOpcUaBridge(server, source)
    return _bridge


def reset() -> None:
    """Drop the singletons (test isolation). No socket is bound, so safe."""
    global _server, _bridge, _mode, _pv
    _server = None
    _bridge = None
    _mode = "psu"
    _pv = PvArraySource()


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
    source: str  # "psu" | "pv"


class SourceIn(BaseModel):
    mode: str = Field(pattern="^(psu|pv)$")


class IvPoint(BaseModel):
    v: float
    i: float
    p: float


class IvCurveOut(BaseModel):
    module: str
    isc: float
    voc: float
    imp: float
    vmp: float
    mpp: IvPoint
    operating_point: IvPoint
    curve: List[IvPoint]


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
        source=_mode,
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


@router.post("/psu/source", response_model=SourceIn)
async def set_source(body: SourceIn) -> SourceIn:
    """Switch the DEMO source between a plain bench supply ("psu") and a PV
    array simulator ("pv"). Rebuilds the bridge with the chosen source."""
    global _mode, _bridge
    _mode = body.mode
    _bridge = None  # force rebuild with the new source on next tick
    return body


@router.get("/psu/iv", response_model=IvCurveOut)
async def get_iv_curve() -> IvCurveOut:
    """The DEMO PV module I-V curve, its MPP, and the live operating point."""
    m: PvModule = _pv.module
    mv, mi, mp = max_power_point(m)
    op_v = round(_pv.v, 4)
    from .pv_iv import pv_current

    op_i = round(pv_current(_pv.v, m), 4) if _mode == "pv" else 0.0
    return IvCurveOut(
        module=m.name,
        isc=m.isc, voc=m.voc, imp=m.imp, vmp=m.vmp,
        mpp=IvPoint(v=mv, i=mi, p=mp),
        operating_point=IvPoint(v=op_v, i=op_i, p=round(op_v * op_i, 4)),
        curve=[IvPoint(v=v, i=i, p=p) for v, i, p in iv_curve(m, points=41)],
    )
