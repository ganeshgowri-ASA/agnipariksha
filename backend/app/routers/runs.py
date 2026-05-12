"""TestRun CRUD + telemetry ingestion endpoints."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..models import TestRun

router = APIRouter(prefix="/api/runs", tags=["runs"])


class RunIn(BaseModel):
    module_id: str
    test_type: str
    iec_clause: str = ""
    params: dict[str, Any] = {}
    operator: str = ""
    status: str = "running"


class RunPatch(BaseModel):
    status: Optional[str] = None
    pass_fail: Optional[str] = None
    summary_stats: Optional[dict[str, Any]] = None
    telemetry: Optional[list[dict[str, Any]]] = None
    ended_at: Optional[datetime] = None
    raw_csv_path: Optional[str] = None


class RunOut(BaseModel):
    run_id: str
    module_id: str
    test_type: str
    iec_clause: str
    params: dict[str, Any]
    started_at: str
    ended_at: Optional[str]
    status: str
    pass_fail: Optional[str]
    operator: str
    summary_stats: dict[str, Any]
    telemetry_points: int


def _to_out(r: TestRun) -> RunOut:
    return RunOut(
        run_id=r.run_id,
        module_id=r.module_id,
        test_type=r.test_type,
        iec_clause=r.iec_clause,
        params=r.params,
        started_at=r.started_at.isoformat() if r.started_at else "",
        ended_at=r.ended_at.isoformat() if r.ended_at else None,
        status=r.status,
        pass_fail=r.pass_fail,
        operator=r.operator,
        summary_stats=r.summary_stats,
        telemetry_points=len(r.telemetry),
    )


@router.get("", response_model=list[RunOut])
def list_runs(
    module_id: Optional[str] = None,
    test_type: Optional[str] = None,
    s: Session = Depends(get_session),
) -> list[RunOut]:
    stmt = select(TestRun)
    if module_id:
        stmt = stmt.where(TestRun.module_id == module_id)
    if test_type:
        stmt = stmt.where(TestRun.test_type == test_type)
    rows = s.exec(stmt.order_by(TestRun.started_at.desc())).all()
    return [_to_out(r) for r in rows]


@router.post("", response_model=RunOut, status_code=201)
def create_run(payload: RunIn, s: Session = Depends(get_session)) -> RunOut:
    r = TestRun(
        module_id=payload.module_id,
        test_type=payload.test_type,
        iec_clause=payload.iec_clause,
        operator=payload.operator,
        status=payload.status,
    )
    r.params = payload.params
    s.add(r)
    s.commit()
    s.refresh(r)
    return _to_out(r)


@router.get("/{run_id}", response_model=RunOut)
def get_run(run_id: str, s: Session = Depends(get_session)) -> RunOut:
    r = s.get(TestRun, run_id)
    if not r:
        raise HTTPException(status_code=404, detail="run_not_found")
    return _to_out(r)


@router.patch("/{run_id}", response_model=RunOut)
def update_run(run_id: str, patch: RunPatch, s: Session = Depends(get_session)) -> RunOut:
    r = s.get(TestRun, run_id)
    if not r:
        raise HTTPException(status_code=404, detail="run_not_found")
    if patch.status is not None:
        r.status = patch.status
    if patch.pass_fail is not None:
        r.pass_fail = patch.pass_fail
    if patch.summary_stats is not None:
        r.summary_stats = patch.summary_stats
    if patch.telemetry is not None:
        r.telemetry = patch.telemetry
    if patch.ended_at is not None:
        r.ended_at = patch.ended_at
    if patch.raw_csv_path is not None:
        r.raw_csv_path = patch.raw_csv_path
    s.add(r)
    s.commit()
    s.refresh(r)
    return _to_out(r)


class TelemetryAppend(BaseModel):
    samples: list[dict[str, Any]]


@router.post("/{run_id}/telemetry", response_model=RunOut)
def append_telemetry(run_id: str, payload: TelemetryAppend, s: Session = Depends(get_session)) -> RunOut:
    r = s.get(TestRun, run_id)
    if not r:
        raise HTTPException(status_code=404, detail="run_not_found")
    rows = r.telemetry + list(payload.samples)
    # Keep the last 5_000 samples — enough for AI summarisation.
    if len(rows) > 5000:
        rows = rows[-5000:]
    r.telemetry = rows
    s.add(r)
    s.commit()
    s.refresh(r)
    return _to_out(r)
