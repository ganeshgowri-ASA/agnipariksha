"""POST /api/reports/generate — backend PDF builder.

Accepts a JSON payload shaped like the frontend ``TestSession`` (with
optional operator/customer/equipment fields added by
``stampOperatorContext`` on the frontend) and returns
``application/pdf`` bytes. The PDF is built by
:mod:`backend.reports.builders.iec_report`.

Why a backend route instead of jsPDF in the browser:

* Reproducible byte-for-byte from same payload + same code revision
  (PV qualification reports are legal artifacts; auditors expect this).
* Charts via matplotlib (deterministic) instead of canvas SVG.
* CSV appendix + SHA-256 over the raw file lives server-side.

The legacy ``frontend/app/api/reports/generate/route.ts`` is kept as a
fallback for offline/DEMO situations; it returns a minimal text-only
PDF when the backend is unreachable.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import Response

from backend.reports import build_iec_report

router = APIRouter(prefix="/api/reports", tags=["reports"])
log = logging.getLogger(__name__)


@router.post("/generate")
async def generate_report(payload: dict[str, Any]) -> Response:
    """Build an IEC-compliant PDF for the supplied session payload.

    Returns ``application/pdf``. Failures bubble up as HTTP 500 with the
    error class name so frontend toasts can surface them.
    """
    if not isinstance(payload, dict) or "id" not in payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="payload must be a JSON object with at least an `id` field",
        )
    try:
        pdf_bytes = build_iec_report(payload)
    except Exception as exc:  # pragma: no cover - reported via 500
        log.exception("PDF build failed for session %s", payload.get("id"))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"PDF build failed: {type(exc).__name__}: {exc}",
        ) from exc

    filename = f"{payload.get('id', 'session')}-iec-report.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
