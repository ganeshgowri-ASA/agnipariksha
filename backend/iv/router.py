"""HTTP routes for the 4-Quadrant IV acquisition mode.

Endpoints
---------
- ``POST /api/iv/4q/start``         — kick off a sweep; returns ``run_id``
- ``GET  /api/iv/4q/curve/{run_id}`` — V/I arrays plus derived metrics

Safety
------
The PSU output is forced OFF before every sweep — this is an
SMU-characterisation flow, not a PSU stress flow. A missing PSU is
tolerated (the SMU is independent).
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

try:
    from ..config import get_settings
    from ..scpi_async import ScpiClient, ScpiUnreachable
    from .four_quadrant import B2901aSmu, IvCurve, IvSweepConfig
except ImportError:  # pragma: no cover - script-mode fallback
    from config import get_settings  # type: ignore[no-redef]
    from scpi_async import ScpiClient, ScpiUnreachable  # type: ignore[no-redef]
    from iv.four_quadrant import B2901aSmu, IvCurve, IvSweepConfig  # type: ignore[no-redef]


_LOG = logging.getLogger("agnipariksha.iv4q")

router = APIRouter(prefix="/api/iv/4q", tags=["iv-4quadrant"])

# Process-wide store of recently captured curves, keyed by run_id. Bounded
# because each curve can carry up to ~2k points; older entries evict FIFO.
_STORE: Dict[str, IvCurve] = {}
_STORE_MAX = 32


class IvStartRequest(BaseModel):
    vmin: float = Field(..., description="Sweep start voltage (V).")
    vmax: float = Field(..., description="Sweep stop voltage (V).")
    steps: int = Field(101, ge=2, le=2001)
    dwell_ms: float = Field(20.0, ge=0.0, le=5000.0)
    compliance_i: float = Field(10.0, gt=0.0, le=21.0)
    nplc: float = Field(1.0, gt=0.0, le=100.0)
    four_wire: bool = True


class IvStartResponse(BaseModel):
    run_id: str
    accepted: bool
    demo: bool
    source: str
    psu_output_off: bool


class IvCurveResponse(BaseModel):
    run_id: str
    v: list[float]
    i: list[float]
    pmax: float
    voc: float
    isc: float
    vmpp: float
    impp: float
    ff: float
    eta: float
    demo: bool
    source: str
    timestamp: int
    config: dict


def _build_smu() -> B2901aSmu:
    """Construct the SMU controller. In DEMO_MODE (or when the B2901A
    isn't registered) returns a sim-backed instance."""
    s = get_settings()
    demo = s.DEMO_MODE
    transport = None
    if not demo:
        try:
            from ..app.devices import get_registry  # noqa: WPS433
        except ImportError:  # pragma: no cover
            from app.devices import get_registry  # type: ignore[no-redef]
        device = get_registry().get("smu_b2901a")
        if device is None or device.demo:
            demo = True
        else:
            try:
                transport = device.get_transport()
            except Exception as exc:  # noqa: BLE001
                _LOG.warning("SMU transport build failed, demo fallback: %s", exc)
                demo = True
    return B2901aSmu(transport=transport, demo=demo)


async def _ensure_psu_off() -> bool:
    """Send ``OUTP OFF`` to the ITECH PSU; never raises. Returns True if
    the command was issued (or demo-acknowledged)."""
    s = get_settings()
    client = ScpiClient(demo_mode=s.DEMO_MODE)
    try:
        try:
            await client.connect(max_attempts=1)
        except ScpiUnreachable:
            return s.DEMO_MODE
        await client.send("OUTP OFF")
        return True
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("PSU OUTP OFF preflight failed (continuing): %s", exc)
        return False
    finally:
        try:
            await client.close()
        except Exception:
            pass


def _store_put(curve: IvCurve) -> None:
    _STORE[curve.run_id] = curve
    while len(_STORE) > _STORE_MAX:
        # FIFO eviction — dict preserves insertion order.
        _STORE.pop(next(iter(_STORE)))


@router.post("/start", response_model=IvStartResponse)
async def iv_4q_start(body: IvStartRequest) -> IvStartResponse:
    cfg = IvSweepConfig(
        vmin=body.vmin, vmax=body.vmax, steps=body.steps,
        dwell_ms=body.dwell_ms, compliance_i=body.compliance_i,
        nplc=body.nplc, four_wire=body.four_wire,
    )
    try:
        cfg.validate()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    psu_off = await _ensure_psu_off()
    smu = _build_smu()
    run_id = f"iv4q-{uuid.uuid4().hex[:12]}"
    try:
        curve = await smu.acquire(cfg, run_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=503,
            detail={"error": "smu_sweep_failed", "reason": f"{type(exc).__name__}: {exc}"},
        ) from exc
    _store_put(curve)
    return IvStartResponse(
        run_id=run_id,
        accepted=True,
        demo=curve.demo,
        source=curve.source,
        psu_output_off=psu_off,
    )


@router.get("/curve/{run_id}", response_model=IvCurveResponse)
async def iv_4q_curve(run_id: str) -> IvCurveResponse:
    curve = _STORE.get(run_id)
    if curve is None:
        raise HTTPException(status_code=404, detail=f"run_id {run_id!r} not found")
    return IvCurveResponse(
        run_id=curve.run_id, v=curve.v, i=curve.i,
        pmax=curve.pmax, voc=curve.voc, isc=curve.isc,
        vmpp=curve.vmpp, impp=curve.impp, ff=curve.ff, eta=curve.eta,
        demo=curve.demo, source=curve.source,
        timestamp=curve.timestamp, config=curve.config,
    )
