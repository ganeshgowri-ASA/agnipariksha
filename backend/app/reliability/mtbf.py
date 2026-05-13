"""MTBF / MTTR / availability from a maintenance ticket history."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable, List, Optional, Tuple

from .models import MaintenanceTicket

SECONDS_PER_HOUR = 3600.0


def _failures(tickets: Iterable[MaintenanceTicket]) -> List[MaintenanceTicket]:
    rows = [t for t in tickets if t.kind == "failure"]
    rows.sort(key=lambda t: t.opened_at)
    return rows


def failure_intervals_hours(tickets: Iterable[MaintenanceTicket]) -> List[float]:
    """Time between consecutive failure openings, in hours.

    A single failure yields no interval. Reorder/service tickets are ignored.
    """
    failures = _failures(tickets)
    intervals: List[float] = []
    for prev, curr in zip(failures, failures[1:]):
        delta = (curr.opened_at - prev.opened_at).total_seconds()
        if delta > 0:
            intervals.append(delta / SECONDS_PER_HOUR)
    return intervals


def repair_durations_hours(tickets: Iterable[MaintenanceTicket]) -> List[float]:
    out: List[float] = []
    for t in tickets:
        if t.kind != "failure":
            continue
        if t.closed_at is None:
            continue
        secs = (t.closed_at - t.opened_at).total_seconds()
        if secs > 0:
            out.append(secs / SECONDS_PER_HOUR)
    return out


def compute_mtbf_mttr(
    tickets: Iterable[MaintenanceTicket],
) -> Tuple[Optional[float], Optional[float]]:
    """Return (mtbf_hours, mttr_hours). Either may be None if not estimable."""
    ticket_list = list(tickets)
    intervals = failure_intervals_hours(ticket_list)
    repairs = repair_durations_hours(ticket_list)
    mtbf = sum(intervals) / len(intervals) if intervals else None
    mttr = sum(repairs) / len(repairs) if repairs else None
    return mtbf, mttr


def availability(
    mtbf_hours: Optional[float], mttr_hours: Optional[float]
) -> float:
    """Steady-state availability = MTBF / (MTBF + MTTR).

    If MTBF is unknown we cannot estimate -> return 1.0 (no observed failures
    so assume healthy). If MTTR is unknown but MTBF is known we assume zero
    repair time (best-case) so availability is 1.0.
    """
    if mtbf_hours is None or mtbf_hours <= 0:
        return 1.0
    if mttr_hours is None or mttr_hours <= 0:
        return 1.0
    return mtbf_hours / (mtbf_hours + mttr_hours)


def last_failure_at(tickets: Iterable[MaintenanceTicket]) -> Optional[datetime]:
    failures = _failures(tickets)
    if not failures:
        return None
    ts = failures[-1].opened_at
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts
