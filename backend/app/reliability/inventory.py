"""Spare parts inventory CRUD with auto-reorder ticket generation."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from .models import MaintenanceTicket, ReliabilityStore, SparePart, get_store


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_part(
    sku: str,
    name: str,
    quantity: int = 0,
    reorder_level: int = 1,
    reorder_qty: int = 5,
    location: str = "",
    store: Optional[ReliabilityStore] = None,
) -> SparePart:
    store = store or get_store()
    part = SparePart(
        sku=sku,
        name=name,
        quantity=max(0, int(quantity)),
        reorder_level=max(0, int(reorder_level)),
        reorder_qty=max(1, int(reorder_qty)),
        location=location,
        updated_at=_now(),
    )
    store.add_part(part)
    _maybe_reorder(part, store)
    return part


def update_part(
    part_id: str,
    *,
    quantity: Optional[int] = None,
    reorder_level: Optional[int] = None,
    reorder_qty: Optional[int] = None,
    name: Optional[str] = None,
    location: Optional[str] = None,
    store: Optional[ReliabilityStore] = None,
) -> Optional[SparePart]:
    store = store or get_store()
    part = store.get_part(part_id)
    if part is None:
        return None
    if quantity is not None:
        part.quantity = max(0, int(quantity))
    if reorder_level is not None:
        part.reorder_level = max(0, int(reorder_level))
    if reorder_qty is not None:
        part.reorder_qty = max(1, int(reorder_qty))
    if name is not None:
        part.name = name
    if location is not None:
        part.location = location
    part.updated_at = _now()
    _maybe_reorder(part, store)
    return part


def delete_part(part_id: str, store: Optional[ReliabilityStore] = None) -> bool:
    store = store or get_store()
    return store.remove_part(part_id)


def list_parts(store: Optional[ReliabilityStore] = None) -> List[SparePart]:
    store = store or get_store()
    return store.list_parts()


def consume_part(
    part_id: str, count: int = 1, store: Optional[ReliabilityStore] = None
) -> Optional[SparePart]:
    """Decrement stock by ``count`` (clamped at 0). Triggers auto-reorder."""
    store = store or get_store()
    part = store.get_part(part_id)
    if part is None:
        return None
    part.quantity = max(0, part.quantity - max(0, int(count)))
    part.updated_at = _now()
    _maybe_reorder(part, store)
    return part


def check_reorder(store: Optional[ReliabilityStore] = None) -> List[MaintenanceTicket]:
    """Run reorder check across all parts. Returns the tickets created."""
    store = store or get_store()
    created: List[MaintenanceTicket] = []
    for part in store.list_parts():
        ticket = _maybe_reorder(part, store)
        if ticket is not None:
            created.append(ticket)
    return created


def _has_open_reorder(part: SparePart, store: ReliabilityStore) -> bool:
    tag = f"reorder:{part.sku}"
    for t in store.list_tickets(equipment_id=tag):
        if t.kind == "reorder" and t.status != "closed":
            return True
    return False


def _maybe_reorder(
    part: SparePart, store: ReliabilityStore
) -> Optional[MaintenanceTicket]:
    if part.quantity > part.reorder_level:
        return None
    if _has_open_reorder(part, store):
        return None
    ticket = MaintenanceTicket(
        equipment_id=f"reorder:{part.sku}",
        kind="reorder",
        status="open",
        note=(
            f"Auto-reorder {part.reorder_qty}x {part.sku} ({part.name}); "
            f"qty={part.quantity} <= reorder_level={part.reorder_level}"
        ),
    )
    store.add_ticket(ticket)
    return ticket
