"""HTTP API for IEC-formatted test reports (DEMO fixtures only).

Routes
------
- GET /api/reports               — list available demo runs
- GET /api/reports/{run_id}.html — HTML twin (rendered as Tab 5 in the UI)
- GET /api/reports/{run_id}.pdf  — ReportLab PDF twin
"""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse, Response

from .builder import render_html, render_pdf
from .fixtures import ReportRun, get_run, list_runs

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _require(run_id: str) -> ReportRun:
    run = get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"unknown run_id: {run_id}")
    return run


@router.get("")
def list_reports() -> List[dict]:
    return [
        {"run_id": r.run_id, "module_id": r.module_id, "overall": r.overall, "tests": len(r.tests)}
        for r in list_runs()
    ]


@router.get("/{run_id}.html", response_class=HTMLResponse)
def report_html(run_id: str) -> HTMLResponse:
    return HTMLResponse(render_html(_require(run_id)))


@router.get("/{run_id}.pdf")
def report_pdf(run_id: str) -> Response:
    run = _require(run_id)
    return Response(
        content=render_pdf(run),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="agnipariksha-{run.run_id}.pdf"'},
    )
