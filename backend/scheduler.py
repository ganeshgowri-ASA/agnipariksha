"""In-memory scheduler for PV test runs.

Provides:
- Pydantic ``Schedule`` model (equipment_id, run_id, start, end, status).
- Conflict detection across per-equipment timelines.
- Next-available-slot search with configurable horizon + lead time.
- ICS (RFC 5545) export for calendar import.

The store is intentionally process-local: schedules live in a module-level dict
and a JSON file under ``logs/`` so dev/demo deployments survive restarts.
Production deployments can swap in a SQL backend by replacing ``_load`` /
``_save`` and ``ScheduleStore``.
"""
from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Optional

from pydantic import BaseModel, Field, field_validator


VALID_STATUSES = {"planned", "running", "completed", "cancelled"}
DEFAULT_HORIZON_DAYS = 30


class Schedule(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    equipment_id: str
    run_id: str
    start: datetime
    end: datetime
    status: str = "planned"

    @field_validator("start", "end")
    @classmethod
    def _aware_utc(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v.astimezone(timezone.utc)

    @field_validator("status")
    @classmethod
    def _status_ok(cls, v: str) -> str:
        if v not in VALID_STATUSES:
            raise ValueError(f"status must be one of {sorted(VALID_STATUSES)}")
        return v

    def duration(self) -> timedelta:
        return self.end - self.start


class ScheduleCreate(BaseModel):
    equipment_id: str
    run_id: str
    start: datetime
    end: datetime
    status: str = "planned"


class ScheduleUpdate(BaseModel):
    equipment_id: Optional[str] = None
    run_id: Optional[str] = None
    start: Optional[datetime] = None
    end: Optional[datetime] = None
    status: Optional[str] = None


class ConflictError(ValueError):
    def __init__(self, conflicts: list[Schedule]):
        super().__init__("schedule conflicts with existing slots")
        self.conflicts = conflicts


def overlaps(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> bool:
    """Half-open interval overlap: [a_start, a_end) vs [b_start, b_end).

    Back-to-back slots (a_end == b_start) do NOT overlap.
    """
    return a_start < b_end and b_start < a_end


def find_conflicts(
    candidate_start: datetime,
    candidate_end: datetime,
    equipment_id: str,
    existing: Iterable[Schedule],
    ignore_id: Optional[str] = None,
) -> list[Schedule]:
    out: list[Schedule] = []
    for s in existing:
        if s.equipment_id != equipment_id:
            continue
        if ignore_id is not None and s.id == ignore_id:
            continue
        if s.status == "cancelled":
            continue
        if overlaps(candidate_start, candidate_end, s.start, s.end):
            out.append(s)
    return out


def find_next_slot(
    equipment_id: str,
    duration: timedelta,
    existing: Iterable[Schedule],
    *,
    after: Optional[datetime] = None,
    horizon: Optional[timedelta] = None,
) -> Optional[datetime]:
    """Return the earliest start at which ``duration`` fits without conflict.

    - ``after`` defaults to "now" (UTC).
    - ``horizon`` caps the search; default 30 days.
    - Honours back-to-back: a slot ending exactly at T allows the next to begin at T.
    - Overnight spans are handled naturally because we operate on absolute
      timestamps (no wall-clock-only logic).
    """
    if duration <= timedelta(0):
        raise ValueError("duration must be positive")
    now = (after or datetime.now(timezone.utc)).astimezone(timezone.utc)
    limit = now + (horizon or timedelta(days=DEFAULT_HORIZON_DAYS))

    booked = sorted(
        (s for s in existing
         if s.equipment_id == equipment_id and s.status != "cancelled" and s.end > now),
        key=lambda s: s.start,
    )

    cursor = now
    for s in booked:
        if s.start >= cursor + duration:
            return cursor
        if s.end > cursor:
            cursor = s.end
        if cursor + duration > limit:
            return None
    if cursor + duration <= limit:
        return cursor
    return None


def to_ics(schedules: Iterable[Schedule], *, prodid: str = "-//Agnipariksha//Scheduler//EN") -> str:
    """Render schedules as an RFC 5545 VCALENDAR string."""
    def fmt(dt: datetime) -> str:
        return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    now_stamp = fmt(datetime.now(timezone.utc))
    lines: list[str] = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:{prodid}",
        "CALSCALE:GREGORIAN",
    ]
    for s in schedules:
        summary = f"{s.run_id} on {s.equipment_id}"
        lines.extend([
            "BEGIN:VEVENT",
            f"UID:{s.id}@agnipariksha",
            f"DTSTAMP:{now_stamp}",
            f"DTSTART:{fmt(s.start)}",
            f"DTEND:{fmt(s.end)}",
            f"SUMMARY:{summary}",
            f"STATUS:{s.status.upper()}",
            f"CATEGORIES:{s.equipment_id}",
            "END:VEVENT",
        ])
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


class ScheduleStore:
    """Thread-safe in-memory schedule store with JSON persistence."""

    def __init__(self, persistence_path: Optional[Path] = None) -> None:
        self._lock = threading.RLock()
        self._items: dict[str, Schedule] = {}
        self._path = persistence_path
        self._load()

    def _load(self) -> None:
        if not self._path or not self._path.exists():
            return
        try:
            raw = json.loads(self._path.read_text())
        except (OSError, json.JSONDecodeError):
            return
        for item in raw.get("schedules", []):
            try:
                s = Schedule.model_validate(item)
                self._items[s.id] = s
            except Exception:
                continue

    def _save(self) -> None:
        if not self._path:
            return
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            payload = {"schedules": [s.model_dump(mode="json") for s in self._items.values()]}
            self._path.write_text(json.dumps(payload, indent=2))
        except OSError:
            pass

    def list(self, *, equipment_id: Optional[str] = None) -> list[Schedule]:
        with self._lock:
            items = list(self._items.values())
        if equipment_id:
            items = [s for s in items if s.equipment_id == equipment_id]
        items.sort(key=lambda s: s.start)
        return items

    def get(self, schedule_id: str) -> Optional[Schedule]:
        with self._lock:
            return self._items.get(schedule_id)

    def create(self, payload: ScheduleCreate) -> Schedule:
        with self._lock:
            tmp = Schedule(**payload.model_dump())
            if tmp.end <= tmp.start:
                raise ValueError("end must be after start")
            conflicts = find_conflicts(tmp.start, tmp.end, tmp.equipment_id, self._items.values())
            if conflicts:
                raise ConflictError(conflicts)
            self._items[tmp.id] = tmp
            self._save()
            return tmp

    def update(self, schedule_id: str, patch: ScheduleUpdate) -> Schedule:
        with self._lock:
            current = self._items.get(schedule_id)
            if not current:
                raise KeyError(schedule_id)
            data = current.model_dump()
            for k, v in patch.model_dump(exclude_unset=True).items():
                if v is not None:
                    data[k] = v
            updated = Schedule(**data)
            if updated.end <= updated.start:
                raise ValueError("end must be after start")
            conflicts = find_conflicts(
                updated.start, updated.end, updated.equipment_id,
                self._items.values(), ignore_id=schedule_id,
            )
            if conflicts:
                raise ConflictError(conflicts)
            self._items[schedule_id] = updated
            self._save()
            return updated

    def delete(self, schedule_id: str) -> bool:
        with self._lock:
            existed = self._items.pop(schedule_id, None) is not None
            if existed:
                self._save()
            return existed

    def clear(self) -> None:
        with self._lock:
            self._items.clear()
            self._save()

    def next_slot(
        self,
        equipment_id: str,
        duration: timedelta,
        *,
        after: Optional[datetime] = None,
        horizon: Optional[timedelta] = None,
    ) -> Optional[datetime]:
        return find_next_slot(
            equipment_id, duration, self.list(),
            after=after, horizon=horizon,
        )
