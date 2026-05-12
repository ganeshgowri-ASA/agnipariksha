"""FastAPI router for the scheduler subsystem."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Response

try:
    from .scheduler import (
        ConflictError,
        Schedule,
        ScheduleCreate,
        ScheduleStore,
        ScheduleUpdate,
        to_ics,
    )
except ImportError:  # pragma: no cover - script-mode fallback
    from scheduler import (  # type: ignore[no-redef]
        ConflictError,
        Schedule,
        ScheduleCreate,
        ScheduleStore,
        ScheduleUpdate,
        to_ics,
    )


_DEFAULT_STORE: Optional[ScheduleStore] = None


def get_store() -> ScheduleStore:
    global _DEFAULT_STORE
    if _DEFAULT_STORE is None:
        _DEFAULT_STORE = ScheduleStore(persistence_path=Path("logs/schedules.json"))
    return _DEFAULT_STORE


def set_store(store: ScheduleStore) -> None:
    """Override the module-level store. Used by tests."""
    global _DEFAULT_STORE
    _DEFAULT_STORE = store


router = APIRouter(prefix="/api/scheduler", tags=["scheduler"])


@router.get("/schedules", response_model=list[Schedule])
def list_schedules(equipment_id: Optional[str] = None) -> list[Schedule]:
    return get_store().list(equipment_id=equipment_id)


@router.get("/schedules/{schedule_id}", response_model=Schedule)
def get_schedule(schedule_id: str) -> Schedule:
    s = get_store().get(schedule_id)
    if not s:
        raise HTTPException(status_code=404, detail="schedule not found")
    return s


@router.post("/schedules", response_model=Schedule, status_code=201)
def create_schedule(payload: ScheduleCreate) -> Schedule:
    try:
        return get_store().create(payload)
    except ConflictError as e:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "conflict",
                "conflicts": [s.model_dump(mode="json") for s in e.conflicts],
            },
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/schedules/{schedule_id}", response_model=Schedule)
def update_schedule(schedule_id: str, patch: ScheduleUpdate) -> Schedule:
    try:
        return get_store().update(schedule_id, patch)
    except KeyError:
        raise HTTPException(status_code=404, detail="schedule not found")
    except ConflictError as e:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "conflict",
                "conflicts": [s.model_dump(mode="json") for s in e.conflicts],
            },
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/schedules/{schedule_id}", status_code=204)
def delete_schedule(schedule_id: str) -> Response:
    if not get_store().delete(schedule_id):
        raise HTTPException(status_code=404, detail="schedule not found")
    return Response(status_code=204)


@router.get("/next-slot")
def next_slot(
    equipment_id: str = Query(..., min_length=1),
    duration_h: float = Query(..., gt=0, le=24 * 60),
    after: Optional[datetime] = Query(None, description="ISO 8601; defaults to now"),
    horizon_days: float = Query(30, gt=0, le=365),
) -> dict:
    store = get_store()
    duration = timedelta(hours=duration_h)
    horizon = timedelta(days=horizon_days)
    start = store.next_slot(equipment_id, duration, after=after, horizon=horizon)
    if start is None:
        return {
            "equipment_id": equipment_id,
            "duration_h": duration_h,
            "start": None,
            "end": None,
            "found": False,
        }
    end = start + duration
    return {
        "equipment_id": equipment_id,
        "duration_h": duration_h,
        "start": start.astimezone(timezone.utc).isoformat(),
        "end": end.astimezone(timezone.utc).isoformat(),
        "found": True,
    }


@router.get("/export.ics")
def export_ics(equipment_id: Optional[str] = None) -> Response:
    items = get_store().list(equipment_id=equipment_id)
    body = to_ics(items)
    return Response(
        content=body,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="agnipariksha-schedule.ics"'},
    )
