"""HTTP API for the procurement subsystem."""
from __future__ import annotations

from fastapi import APIRouter, Query

from .models import RFQPage, get_store

router = APIRouter(prefix="/api/procurement", tags=["procurement"])


@router.get("/rfq", response_model=RFQPage)
def list_rfqs(
    page: int = Query(default=1, ge=1),
    size: int = Query(default=25, ge=1, le=200),
) -> RFQPage:
    return get_store().list(page=page, size=size)
