"""Tests for the scheduler module: next-slot edge cases, conflicts, ICS."""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.main import app  # noqa: E402
from backend.scheduler import (  # noqa: E402
    ConflictError,
    Schedule,
    ScheduleCreate,
    ScheduleStore,
    ScheduleUpdate,
    find_conflicts,
    find_next_slot,
    overlaps,
    to_ics,
)
from backend.scheduler_api import set_store  # noqa: E402


UTC = timezone.utc


def dt(y: int, m: int, d: int, h: int = 0, mi: int = 0) -> datetime:
    return datetime(y, m, d, h, mi, tzinfo=UTC)


# --------------------------------------------------------------------------
# Pure-function tests
# --------------------------------------------------------------------------
def test_overlap_back_to_back_does_not_overlap():
    a = (dt(2026, 5, 12, 9), dt(2026, 5, 12, 11))
    b = (dt(2026, 5, 12, 11), dt(2026, 5, 12, 13))
    assert overlaps(*a, *b) is False


def test_overlap_inside():
    a = (dt(2026, 5, 12, 9), dt(2026, 5, 12, 11))
    b = (dt(2026, 5, 12, 10), dt(2026, 5, 12, 12))
    assert overlaps(*a, *b) is True


def test_next_slot_empty_returns_after():
    after = dt(2026, 5, 12, 8)
    got = find_next_slot("rig-1", timedelta(hours=2), [], after=after)
    assert got == after


def test_next_slot_back_to_back_picks_gap_end():
    """An existing slot 09-11 with a 2h request after 08:00 should yield 11:00."""
    after = dt(2026, 5, 12, 8)
    existing = [Schedule(
        equipment_id="rig-1", run_id="r1",
        start=dt(2026, 5, 12, 9), end=dt(2026, 5, 12, 11),
    )]
    got = find_next_slot("rig-1", timedelta(hours=2), existing, after=after)
    # 1 hour gap (08-09) is too small, so we slide past the booking → 11:00
    assert got == dt(2026, 5, 12, 11)


def test_next_slot_fits_in_gap_between_two_bookings():
    after = dt(2026, 5, 12, 6)
    existing = [
        Schedule(equipment_id="rig-1", run_id="a",
                 start=dt(2026, 5, 12, 8), end=dt(2026, 5, 12, 10)),
        Schedule(equipment_id="rig-1", run_id="b",
                 start=dt(2026, 5, 12, 14), end=dt(2026, 5, 12, 18)),
    ]
    # 2h fits in 6-8 gap right at the start
    assert find_next_slot("rig-1", timedelta(hours=2), existing, after=after) == dt(2026, 5, 12, 6)
    # 3h doesn't fit 6-8 → next gap is 10-14, returns 10:00
    assert find_next_slot("rig-1", timedelta(hours=3), existing, after=after) == dt(2026, 5, 12, 10)


def test_next_slot_overnight_span():
    """A booking that crosses midnight must consume both calendar days."""
    after = dt(2026, 5, 12, 20)
    existing = [Schedule(
        equipment_id="rig-1", run_id="overnight",
        start=dt(2026, 5, 12, 22), end=dt(2026, 5, 13, 6),
    )]
    # 4h request → can't fit 20-22 (only 2h), must wait until 06:00 next day
    got = find_next_slot("rig-1", timedelta(hours=4), existing, after=after)
    assert got == dt(2026, 5, 13, 6)


def test_next_slot_ignores_other_equipment():
    after = dt(2026, 5, 12, 8)
    existing = [Schedule(
        equipment_id="rig-2", run_id="x",
        start=dt(2026, 5, 12, 9), end=dt(2026, 5, 12, 11),
    )]
    got = find_next_slot("rig-1", timedelta(hours=2), existing, after=after)
    assert got == after


def test_next_slot_ignores_cancelled():
    after = dt(2026, 5, 12, 8)
    existing = [Schedule(
        equipment_id="rig-1", run_id="x", status="cancelled",
        start=dt(2026, 5, 12, 9), end=dt(2026, 5, 12, 11),
    )]
    assert find_next_slot("rig-1", timedelta(hours=2), existing, after=after) == after


def test_next_slot_returns_none_when_horizon_full():
    after = dt(2026, 5, 12, 8)
    existing = [Schedule(
        equipment_id="rig-1", run_id="block",
        start=dt(2026, 5, 12, 8), end=dt(2026, 5, 14, 8),
    )]
    got = find_next_slot(
        "rig-1", timedelta(hours=4), existing,
        after=after, horizon=timedelta(hours=12),
    )
    assert got is None


def test_next_slot_after_in_middle_of_booking_jumps_to_end():
    after = dt(2026, 5, 12, 10)
    existing = [Schedule(
        equipment_id="rig-1", run_id="active",
        start=dt(2026, 5, 12, 9), end=dt(2026, 5, 12, 12),
    )]
    assert find_next_slot("rig-1", timedelta(hours=1), existing, after=after) == dt(2026, 5, 12, 12)


def test_next_slot_rejects_non_positive_duration():
    with pytest.raises(ValueError):
        find_next_slot("rig-1", timedelta(0), [])


def test_find_conflicts_ignore_id():
    a = Schedule(equipment_id="rig-1", run_id="a",
                 start=dt(2026, 5, 12, 9), end=dt(2026, 5, 12, 11))
    assert find_conflicts(a.start, a.end, a.equipment_id, [a]) == [a]
    assert find_conflicts(a.start, a.end, a.equipment_id, [a], ignore_id=a.id) == []


# --------------------------------------------------------------------------
# Store tests
# --------------------------------------------------------------------------
def test_store_create_and_conflict(tmp_path):
    store = ScheduleStore(persistence_path=tmp_path / "s.json")
    s1 = store.create(ScheduleCreate(
        equipment_id="rig-1", run_id="A",
        start=dt(2026, 5, 12, 9), end=dt(2026, 5, 12, 11),
    ))
    assert s1.id
    with pytest.raises(ConflictError) as ei:
        store.create(ScheduleCreate(
            equipment_id="rig-1", run_id="B",
            start=dt(2026, 5, 12, 10), end=dt(2026, 5, 12, 12),
        ))
    assert ei.value.conflicts and ei.value.conflicts[0].id == s1.id


def test_store_back_to_back_allowed(tmp_path):
    store = ScheduleStore(persistence_path=tmp_path / "s.json")
    store.create(ScheduleCreate(
        equipment_id="rig-1", run_id="A",
        start=dt(2026, 5, 12, 9), end=dt(2026, 5, 12, 11),
    ))
    s2 = store.create(ScheduleCreate(
        equipment_id="rig-1", run_id="B",
        start=dt(2026, 5, 12, 11), end=dt(2026, 5, 12, 13),
    ))
    assert s2.run_id == "B"


def test_store_update_with_self_ignored(tmp_path):
    store = ScheduleStore(persistence_path=tmp_path / "s.json")
    s = store.create(ScheduleCreate(
        equipment_id="rig-1", run_id="A",
        start=dt(2026, 5, 12, 9), end=dt(2026, 5, 12, 11),
    ))
    moved = store.update(s.id, ScheduleUpdate(
        start=dt(2026, 5, 12, 10), end=dt(2026, 5, 12, 12),
    ))
    assert moved.start == dt(2026, 5, 12, 10)


def test_store_persistence_roundtrip(tmp_path):
    path = tmp_path / "s.json"
    s1 = ScheduleStore(persistence_path=path)
    s1.create(ScheduleCreate(
        equipment_id="rig-1", run_id="A",
        start=dt(2026, 5, 12, 9), end=dt(2026, 5, 12, 11),
    ))
    s2 = ScheduleStore(persistence_path=path)
    assert len(s2.list()) == 1


def test_ics_export_contains_event(tmp_path):
    store = ScheduleStore(persistence_path=tmp_path / "s.json")
    s = store.create(ScheduleCreate(
        equipment_id="rig-1", run_id="overnight-A",
        start=dt(2026, 5, 12, 22), end=dt(2026, 5, 13, 6),
    ))
    text = to_ics([s])
    assert "BEGIN:VCALENDAR" in text
    assert "END:VCALENDAR" in text
    assert "BEGIN:VEVENT" in text
    assert "DTSTART:20260512T220000Z" in text
    assert "DTEND:20260513T060000Z" in text
    assert "overnight-A" in text


# --------------------------------------------------------------------------
# HTTP API tests
# --------------------------------------------------------------------------
@pytest.fixture
def client(tmp_path):
    set_store(ScheduleStore(persistence_path=tmp_path / "s.json"))
    with TestClient(app) as c:
        yield c
    set_store(ScheduleStore(persistence_path=tmp_path / "s.json"))


def test_api_crud_and_conflict(client):
    r = client.post("/api/scheduler/schedules", json={
        "equipment_id": "rig-1", "run_id": "A",
        "start": "2026-05-12T09:00:00Z", "end": "2026-05-12T11:00:00Z",
    })
    assert r.status_code == 201
    body = r.json()
    sid = body["id"]

    # conflict
    r = client.post("/api/scheduler/schedules", json={
        "equipment_id": "rig-1", "run_id": "B",
        "start": "2026-05-12T10:00:00Z", "end": "2026-05-12T12:00:00Z",
    })
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "conflict"

    # reschedule
    r = client.patch(f"/api/scheduler/schedules/{sid}", json={
        "start": "2026-05-12T13:00:00Z", "end": "2026-05-12T15:00:00Z",
    })
    assert r.status_code == 200
    assert r.json()["start"].startswith("2026-05-12T13:00:00")

    # list
    r = client.get("/api/scheduler/schedules")
    assert r.status_code == 200
    assert len(r.json()) == 1

    # delete
    r = client.delete(f"/api/scheduler/schedules/{sid}")
    assert r.status_code == 204
    r = client.get("/api/scheduler/schedules")
    assert r.json() == []


def test_api_next_slot(client):
    client.post("/api/scheduler/schedules", json={
        "equipment_id": "rig-1", "run_id": "A",
        "start": "2030-01-01T09:00:00Z", "end": "2030-01-01T11:00:00Z",
    })
    r = client.get("/api/scheduler/next-slot", params={
        "equipment_id": "rig-1", "duration_h": 2,
        "after": "2030-01-01T10:00:00Z",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["found"] is True
    assert body["start"].startswith("2030-01-01T11:00:00")


def test_api_ics_export(client):
    client.post("/api/scheduler/schedules", json={
        "equipment_id": "rig-1", "run_id": "overnight",
        "start": "2026-05-12T22:00:00Z", "end": "2026-05-13T06:00:00Z",
    })
    r = client.get("/api/scheduler/export.ics")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/calendar")
    text = r.text
    assert "BEGIN:VCALENDAR" in text
    assert "DTSTART:20260512T220000Z" in text
