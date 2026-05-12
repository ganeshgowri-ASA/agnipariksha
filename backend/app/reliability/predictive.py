"""Predictive maintenance: risk score and next-service-due date."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from .models import EquipmentHealth, MaintenanceTicket
from .mtbf import (
    availability,
    compute_mtbf_mttr,
    failure_intervals_hours,
    last_failure_at,
)
from .weibull import weibull_cdf, weibull_fit, weibull_quantile

# Probability of failure threshold used to schedule the next service.
DEFAULT_SERVICE_PROB = 0.5


def risk_score(
    shape: Optional[float],
    scale_hours: Optional[float],
    hours_since_last_failure: Optional[float],
    mtbf_hours: Optional[float],
) -> float:
    """Risk score in [0, 100]. Higher = more likely to fail soon.

    If a Weibull fit is available we use the conditional probability of
    failure within the next MTBF/2 hours given survival to ``t``. Without
    a fit we fall back to a simple ratio of elapsed time to MTBF.
    """
    if hours_since_last_failure is None or hours_since_last_failure < 0:
        return 0.0
    if shape is not None and scale_hours is not None and mtbf_hours is not None:
        t = hours_since_last_failure
        horizon = max(mtbf_hours / 2.0, 1.0)
        f_t = weibull_cdf(t, shape, scale_hours)
        f_th = weibull_cdf(t + horizon, shape, scale_hours)
        surv_t = 1.0 - f_t
        if surv_t <= 1e-9:
            return 100.0
        cond = (f_th - f_t) / surv_t
        return round(max(0.0, min(1.0, cond)) * 100.0, 2)
    if mtbf_hours is None or mtbf_hours <= 0:
        return 0.0
    ratio = hours_since_last_failure / mtbf_hours
    return round(min(1.0, max(0.0, ratio)) * 100.0, 2)


def next_service_due(
    last_failure: Optional[datetime],
    shape: Optional[float],
    scale_hours: Optional[float],
    mtbf_hours: Optional[float],
    target_prob: float = DEFAULT_SERVICE_PROB,
    now: Optional[datetime] = None,
) -> Optional[datetime]:
    """Return the timestamp by which a service is recommended."""
    if last_failure is None:
        return None
    if last_failure.tzinfo is None:
        last_failure = last_failure.replace(tzinfo=timezone.utc)
    now = (now or datetime.now(timezone.utc))
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    if shape is not None and scale_hours is not None:
        try:
            hours = weibull_quantile(target_prob, shape, scale_hours)
        except ValueError:
            hours = mtbf_hours or 0.0
    elif mtbf_hours is not None:
        hours = mtbf_hours
    else:
        return None
    due = last_failure + timedelta(hours=max(hours, 0.0))
    # Never schedule a service in the past — push to "now + 1h" instead.
    if due < now:
        due = now + timedelta(hours=1)
    return due


def equipment_health(
    equipment_id: str,
    tickets: Iterable[MaintenanceTicket],
    window: int = 50,
    now: Optional[datetime] = None,
) -> EquipmentHealth:
    ticket_list = list(tickets)
    intervals = failure_intervals_hours(ticket_list)
    fit = weibull_fit(intervals, window=window)
    mtbf, mttr = compute_mtbf_mttr(ticket_list)
    avail = availability(mtbf, mttr)
    last_fail = last_failure_at(ticket_list)
    now = (now or datetime.now(timezone.utc))
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    hours_since = None
    if last_fail is not None:
        hours_since = (now - last_fail).total_seconds() / 3600.0
        if hours_since < 0:
            hours_since = 0.0
    shape, scale = (fit if fit is not None else (None, None))
    score = risk_score(shape, scale, hours_since, mtbf)
    due = next_service_due(last_fail, shape, scale, mtbf, now=now)
    failures = sum(1 for t in ticket_list if t.kind == "failure")
    return EquipmentHealth(
        equipment_id=equipment_id,
        failures=failures,
        mtbf_hours=mtbf,
        mttr_hours=mttr,
        availability=round(avail, 4),
        weibull_shape=shape,
        weibull_scale_hours=scale,
        risk_score=score,
        next_service_due=due,
        last_failure_at=last_fail,
    )
