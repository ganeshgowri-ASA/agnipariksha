"""HTTP API for reliability analytics and spare parts."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import inventory as inv
from .models import EquipmentHealth, MaintenanceTicket, SparePart, get_store
from .predictive import equipment_health

router = APIRouter(prefix="/api/reliability", tags=["reliability"])


class TicketIn(BaseModel):
    equipment_id: str
    kind: str = "failure"
    opened_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    status: str = "open"
    note: str = ""


@router.get("/tickets", response_model=List[MaintenanceTicket])
def list_tickets(equipment_id: Optional[str] = None) -> List[MaintenanceTicket]:
    return get_store().list_tickets(equipment_id=equipment_id)


@router.post("/tickets", response_model=MaintenanceTicket)
def create_ticket(payload: TicketIn) -> MaintenanceTicket:
    data = payload.model_dump(exclude_none=True)
    ticket = MaintenanceTicket(**data)
    return get_store().add_ticket(ticket)


@router.get("/equipment", response_model=List[EquipmentHealth])
def equipment_dashboard() -> List[EquipmentHealth]:
    store = get_store()
    out: List[EquipmentHealth] = []
    for eq_id in store.equipment_ids():
        if eq_id.startswith("reorder:"):
            continue
        out.append(equipment_health(eq_id, store.list_tickets(eq_id)))
    return out


@router.get("/equipment/{equipment_id}", response_model=EquipmentHealth)
def equipment_detail(equipment_id: str) -> EquipmentHealth:
    store = get_store()
    tickets = store.list_tickets(equipment_id)
    if not tickets:
        raise HTTPException(status_code=404, detail="unknown equipment")
    return equipment_health(equipment_id, tickets)


# --- inventory ----------------------------------------------------------

class PartIn(BaseModel):
    sku: str
    name: str
    quantity: int = 0
    reorder_level: int = 1
    reorder_qty: int = Field(default=5, ge=1)
    location: str = ""


class PartPatch(BaseModel):
    quantity: Optional[int] = None
    reorder_level: Optional[int] = None
    reorder_qty: Optional[int] = Field(default=None, ge=1)
    name: Optional[str] = None
    location: Optional[str] = None


@router.get("/parts", response_model=List[SparePart])
def list_parts() -> List[SparePart]:
    return inv.list_parts()


@router.post("/parts", response_model=SparePart)
def create_part(payload: PartIn) -> SparePart:
    return inv.create_part(**payload.model_dump())


@router.patch("/parts/{part_id}", response_model=SparePart)
def patch_part(part_id: str, payload: PartPatch) -> SparePart:
    updated = inv.update_part(
        part_id, **payload.model_dump(exclude_none=True)
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="unknown part")
    return updated


@router.delete("/parts/{part_id}")
def delete_part(part_id: str) -> dict:
    ok = inv.delete_part(part_id)
    if not ok:
        raise HTTPException(status_code=404, detail="unknown part")
    return {"deleted": True}


@router.post("/parts/{part_id}/consume", response_model=SparePart)
def consume_part(part_id: str, count: int = 1) -> SparePart:
    part = inv.consume_part(part_id, count=count)
    if part is None:
        raise HTTPException(status_code=404, detail="unknown part")
    return part


@router.post("/parts/check-reorder", response_model=List[MaintenanceTicket])
def check_reorder() -> List[MaintenanceTicket]:
    return inv.check_reorder()
