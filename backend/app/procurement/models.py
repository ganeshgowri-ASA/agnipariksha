"""RFQ (Request For Quotation) domain model and in-memory store.

The store mirrors the pattern used by ``backend.app.reliability.models`` —
thread-safe, swappable for a DB-backed implementation later. Seed data
makes the list non-empty in demo deployments so the UI can be exercised
without manual data entry.
"""
from __future__ import annotations

import threading
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

RFQStatus = Literal["draft", "sent", "received", "accepted", "rejected", "expired"]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _gen_id() -> str:
    return f"rfq-{uuid.uuid4().hex[:10]}"


class RFQ(BaseModel):
    id: str = Field(default_factory=_gen_id)
    rfq_no: str
    vendor: str
    items: int = Field(ge=0, default=0)
    total: float = Field(ge=0.0, default=0.0)
    status: RFQStatus = "draft"
    created_at: datetime = Field(default_factory=_utcnow)


class RFQPage(BaseModel):
    items: List[RFQ]
    page: int
    size: int
    total: int


class RFQStore:
    """Thread-safe in-memory RFQ store ordered by created_at desc."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._rows: Dict[str, RFQ] = {}

    def add(self, rfq: RFQ) -> RFQ:
        with self._lock:
            self._rows[rfq.id] = rfq
            return rfq

    def list(self, page: int, size: int) -> RFQPage:
        with self._lock:
            rows = list(self._rows.values())
        rows.sort(key=lambda r: r.created_at, reverse=True)
        total = len(rows)
        start = (page - 1) * size
        items = rows[start : start + size]
        return RFQPage(items=items, page=page, size=size, total=total)

    def reset(self) -> None:
        with self._lock:
            self._rows.clear()


def _seed(store: RFQStore) -> None:
    """Populate enough RFQs to exercise multi-page pagination in demo."""
    base = datetime(2026, 1, 5, 9, 0, tzinfo=timezone.utc)
    vendors = ("Acme Sensors", "Bharat Cables", "ChromaTech", "Delta Optics")
    statuses: List[RFQStatus] = ["draft", "sent", "received", "accepted", "rejected"]
    for i in range(32):
        store.add(
            RFQ(
                rfq_no=f"RFQ-2026-{1001 + i:04d}",
                vendor=vendors[i % len(vendors)],
                items=2 + (i % 7),
                total=round(1250.0 + i * 137.42, 2),
                status=statuses[i % len(statuses)],
                created_at=base + timedelta(hours=i * 5),
            )
        )


_default_store = RFQStore()
_seed(_default_store)


def get_store() -> RFQStore:
    return _default_store
