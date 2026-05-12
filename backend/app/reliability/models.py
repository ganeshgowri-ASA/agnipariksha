"""Domain models and in-memory store for reliability analytics.

Persistence is deliberately in-memory: the production deployment swaps in
TimescaleDB via ``backend.database`` but the analytics layer is pure so it
stays unit-testable without a live database.
"""
from __future__ import annotations

import threading
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

TicketKind = Literal["failure", "repair", "service", "reorder"]
TicketStatus = Literal["open", "in_progress", "closed"]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _gen_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


class MaintenanceTicket(BaseModel):
    id: str = Field(default_factory=lambda: _gen_id("tkt"))
    equipment_id: str
    kind: TicketKind = "failure"
    opened_at: datetime = Field(default_factory=_utcnow)
    closed_at: Optional[datetime] = None
    status: TicketStatus = "open"
    note: str = ""

    @property
    def repair_seconds(self) -> Optional[float]:
        if self.closed_at is None:
            return None
        return (self.closed_at - self.opened_at).total_seconds()


class SparePart(BaseModel):
    id: str = Field(default_factory=lambda: _gen_id("prt"))
    sku: str
    name: str
    quantity: int = 0
    reorder_level: int = 1
    reorder_qty: int = 5
    location: str = ""
    updated_at: datetime = Field(default_factory=_utcnow)


class EquipmentHealth(BaseModel):
    equipment_id: str
    failures: int
    mtbf_hours: Optional[float]
    mttr_hours: Optional[float]
    availability: float
    weibull_shape: Optional[float]
    weibull_scale_hours: Optional[float]
    risk_score: float
    next_service_due: Optional[datetime]
    last_failure_at: Optional[datetime]


class ReliabilityStore:
    """Thread-safe in-memory store."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.tickets: Dict[str, MaintenanceTicket] = {}
        self.parts: Dict[str, SparePart] = {}

    # tickets ---------------------------------------------------------
    def add_ticket(self, ticket: MaintenanceTicket) -> MaintenanceTicket:
        with self._lock:
            self.tickets[ticket.id] = ticket
            return ticket

    def list_tickets(self, equipment_id: Optional[str] = None) -> List[MaintenanceTicket]:
        with self._lock:
            rows = list(self.tickets.values())
        if equipment_id is not None:
            rows = [t for t in rows if t.equipment_id == equipment_id]
        rows.sort(key=lambda t: t.opened_at)
        return rows

    def equipment_ids(self) -> List[str]:
        with self._lock:
            return sorted({t.equipment_id for t in self.tickets.values()})

    # parts -----------------------------------------------------------
    def add_part(self, part: SparePart) -> SparePart:
        with self._lock:
            self.parts[part.id] = part
            return part

    def get_part(self, part_id: str) -> Optional[SparePart]:
        with self._lock:
            return self.parts.get(part_id)

    def remove_part(self, part_id: str) -> bool:
        with self._lock:
            return self.parts.pop(part_id, None) is not None

    def list_parts(self) -> List[SparePart]:
        with self._lock:
            rows = list(self.parts.values())
        rows.sort(key=lambda p: p.sku)
        return rows

    def reset(self) -> None:
        with self._lock:
            self.tickets.clear()
            self.parts.clear()


_default_store = ReliabilityStore()


def get_store() -> ReliabilityStore:
    return _default_store
