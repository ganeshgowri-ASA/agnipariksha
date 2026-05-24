"""HTTP routes for the Bypass Diode Test (BDT).

Currently exposes a stub for the IEC 61215-2 MQT 18.1 pulse-test recipe
endpoint. Persistence + scheduling is intentionally deferred to a later
backend PR (P-backend); until then the endpoint accepts the payload and
returns 501 so the frontend setup form can wire its submit path now.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/bdt", tags=["bdt"])


@router.post("/mqt18-1/recipes")
async def create_mqt18_recipe(_payload: dict[str, Any] | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=501,
        content={
            "detail": "MQT 18.1 recipe persistence is not implemented yet (P-backend).",
            "code": "not_implemented",
        },
    )
