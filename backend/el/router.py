"""HTTP router for the EL capture stub.

POST /api/el/capture -> orchestrator.run_el_capture(...)
Refuses with 503 when DEMO_MODE is False (no live-psu-gate yet).
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

try:
    from ..config import get_settings
    from .orchestrator import run_el_capture
except ImportError:  # pragma: no cover - script-mode fallback
    from config import get_settings  # type: ignore[no-redef]
    from el.orchestrator import run_el_capture  # type: ignore[no-redef]


router = APIRouter(prefix="/api/el", tags=["el"])


class ELCaptureRequest(BaseModel):
    module_id: str = Field(..., min_length=1, max_length=64)
    isc_a: float = Field(..., gt=0.0, le=50.0)
    exposure_ms: int = Field(..., gt=0, le=60_000)
    gain: float = Field(..., gt=0.0, le=100.0)


@router.post("/capture")
async def el_capture(req: ELCaptureRequest) -> dict:
    if not get_settings().DEMO_MODE:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "el_capture_disabled_in_live_mode",
                "reason": "Live EL requires PR #52 (live-psu-gate) + camera SDK.",
            },
        )
    try:
        return run_el_capture(req.module_id, req.isc_a, req.exposure_ms, req.gain)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
