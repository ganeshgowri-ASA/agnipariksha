"""Procurement: Purchase Orders.

Implements G5 — a paginated PO list with the columns required by the
purchasing workbench:

    PO #, vendor, RFQ ref, total, status, ETA

REST surface (mounted by ``main.py``)::

    GET    /api/procurement/po?page=<int>&size=<int>   -> paginated list
    POST   /api/procurement/po                         -> create
    GET    /api/procurement/po/{po_id}                 -> fetch one
    POST   /api/procurement/po/_reset                  -> test hook (gated)

The store is in-process so the feature works without a database; the API
surface is intentionally stable so a SQL-backed store can drop in later
without UI changes. Mirrors the structure used by ``tickets.py``.
"""
from __future__ import annotations

import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Domain types
# ---------------------------------------------------------------------------
POStatus = Literal[
    "draft",
    "issued",
    "acknowledged",
    "shipped",
    "received",
    "closed",
    "cancelled",
]

ALLOWED_STATUSES: tuple[POStatus, ...] = (
    "draft",
    "issued",
    "acknowledged",
    "shipped",
    "received",
    "closed",
    "cancelled",
)


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------
class PurchaseOrderCreate(BaseModel):
    po_number: str = Field(min_length=1, max_length=64)
    vendor: str = Field(min_length=1, max_length=200)
    rfq_ref: Optional[str] = Field(default=None, max_length=64)
    total: float = Field(ge=0)
    currency: str = Field(default="INR", min_length=3, max_length=8)
    status: POStatus = "draft"
    eta: Optional[str] = None  # ISO date, e.g. "2026-06-30"

    @field_validator("po_number", "vendor")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        return v


class PurchaseOrderOut(BaseModel):
    id: str
    po_number: str
    vendor: str
    rfq_ref: Optional[str]
    total: float
    currency: str
    status: POStatus
    eta: Optional[str]
    created_at: float
    updated_at: float


class PurchaseOrderPage(BaseModel):
    """Standard paginated envelope: matches ?page=&size= conventions."""
    items: List[PurchaseOrderOut]
    total: int
    page: int
    size: int
    pages: int


# ---------------------------------------------------------------------------
# In-memory store
# ---------------------------------------------------------------------------
@dataclass
class _PO:
    id: str
    po_number: str
    vendor: str
    rfq_ref: Optional[str]
    total: float
    currency: str
    status: POStatus
    eta: Optional[str]
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def to_out(self) -> PurchaseOrderOut:
        return PurchaseOrderOut(
            id=self.id,
            po_number=self.po_number,
            vendor=self.vendor,
            rfq_ref=self.rfq_ref,
            total=self.total,
            currency=self.currency,
            status=self.status,
            eta=self.eta,
            created_at=self.created_at,
            updated_at=self.updated_at,
        )


class POStore:
    def __init__(self) -> None:
        self._items: Dict[str, _PO] = {}

    def list_sorted(self) -> List[_PO]:
        # Newest first, matches how operators read a PO ledger.
        return sorted(self._items.values(), key=lambda p: p.created_at, reverse=True)

    def get(self, po_id: str) -> _PO:
        po = self._items.get(po_id)
        if po is None:
            raise HTTPException(status_code=404, detail="purchase order not found")
        return po

    def create(self, payload: PurchaseOrderCreate) -> _PO:
        now = time.time()
        po = _PO(
            id=f"PO-{uuid.uuid4().hex[:8].upper()}",
            po_number=payload.po_number,
            vendor=payload.vendor,
            rfq_ref=payload.rfq_ref,
            total=float(payload.total),
            currency=payload.currency,
            status=payload.status,
            eta=payload.eta,
            created_at=now,
            updated_at=now,
        )
        self._items[po.id] = po
        return po

    def reset(self) -> None:
        self._items.clear()


store = POStore()


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------
router = APIRouter(prefix="/api/procurement", tags=["procurement"])

# Bounds for the page-size query so a misbehaving client cannot ask for
# the whole table at once.
_MAX_PAGE_SIZE = 200
_DEFAULT_PAGE_SIZE = 25


@router.get("/po", response_model=PurchaseOrderPage)
def list_purchase_orders(
    page: int = Query(default=1, ge=1),
    size: int = Query(default=_DEFAULT_PAGE_SIZE, ge=1, le=_MAX_PAGE_SIZE),
) -> PurchaseOrderPage:
    items = store.list_sorted()
    total = len(items)
    pages = (total + size - 1) // size if total else 0
    start = (page - 1) * size
    end = start + size
    page_items = items[start:end]
    return PurchaseOrderPage(
        items=[p.to_out() for p in page_items],
        total=total,
        page=page,
        size=size,
        pages=pages,
    )


@router.post("/po", response_model=PurchaseOrderOut, status_code=201)
def create_purchase_order(payload: PurchaseOrderCreate) -> PurchaseOrderOut:
    return store.create(payload).to_out()


@router.get("/po/{po_id}", response_model=PurchaseOrderOut)
def get_purchase_order(po_id: str) -> PurchaseOrderOut:
    return store.get(po_id).to_out()


# Dev/test reset hook — gated by env flag like tickets._reset, never in prod.
@router.post("/po/_reset", include_in_schema=False)
def reset_store(request: Request) -> Dict[str, bool]:
    if not (os.environ.get("AGNI_TEST_MODE") or "PYTEST_CURRENT_TEST" in os.environ):
        raise HTTPException(status_code=404, detail="not found")
    store.reset()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Demo seed — populated on first import so the UI is non-empty in demo mode
# and the pagination is exercised. Keep this idempotent.
# ---------------------------------------------------------------------------
def _seed_demo() -> None:
    if store._items:
        return
    seeds = [
        ("PO-2026-0001", "Suntech Solar Pvt Ltd",     "RFQ-2026-014", 245_800.00, "INR", "shipped",      "2026-05-28"),
        ("PO-2026-0002", "ITECH Electronics",         "RFQ-2026-011", 1_125_000.00, "INR", "acknowledged", "2026-06-10"),
        ("PO-2026-0003", "Keysight Technologies",     "RFQ-2026-016", 86_400.00, "USD", "issued",         "2026-06-22"),
        ("PO-2026-0004", "Espec Climate Chambers",    "RFQ-2026-009", 4_580_000.00, "INR", "received",    "2026-04-30"),
        ("PO-2026-0005", "Vishay India",              "RFQ-2026-019", 32_150.00, "INR", "draft",          None),
        ("PO-2026-0006", "TE Connectivity",           "RFQ-2026-017", 18_900.00, "INR", "issued",         "2026-06-05"),
        ("PO-2026-0007", "Schneider Electric India",  None,           212_000.00, "INR", "closed",        "2026-04-15"),
        ("PO-2026-0008", "Fluke India",               "RFQ-2026-020", 64_750.00, "INR", "acknowledged",   "2026-06-18"),
        ("PO-2026-0009", "Amphenol Solar Tech",       "RFQ-2026-018", 41_200.00, "INR", "shipped",        "2026-05-30"),
        ("PO-2026-0010", "Pyranometer Labs",          "RFQ-2026-013", 158_300.00, "INR", "issued",        "2026-06-12"),
        ("PO-2026-0011", "Phoenix Contact",           "RFQ-2026-021", 27_600.00, "INR", "draft",          None),
        ("PO-2026-0012", "Rittal Enclosures",         "RFQ-2026-010", 92_400.00, "INR", "received",      "2026-04-22"),
        ("PO-2026-0013", "Renishaw Metrology",        "RFQ-2026-022", 9_750.00, "USD", "issued",          "2026-07-02"),
        ("PO-2026-0014", "Mean Well Power Supplies",  "RFQ-2026-023", 14_900.00, "INR", "acknowledged",   "2026-06-08"),
        ("PO-2026-0015", "Wago India",                None,           7_320.00, "INR", "cancelled",      None),
        ("PO-2026-0016", "Yokogawa India",            "RFQ-2026-024", 188_500.00, "INR", "issued",       "2026-06-29"),
        ("PO-2026-0017", "Honeywell Sensors",         "RFQ-2026-025", 33_900.00, "INR", "draft",         None),
        ("PO-2026-0018", "Schurter AG",               "RFQ-2026-026", 12_400.00, "USD", "shipped",       "2026-05-25"),
        ("PO-2026-0019", "Omron Automation",          "RFQ-2026-027", 41_700.00, "INR", "issued",       "2026-06-14"),
        ("PO-2026-0020", "Siemens India",             "RFQ-2026-028", 376_900.00, "INR", "acknowledged", "2026-06-20"),
        ("PO-2026-0021", "Megger Test Equipment",     "RFQ-2026-029", 88_300.00, "INR", "issued",       "2026-06-27"),
        ("PO-2026-0022", "Hioki India",               "RFQ-2026-030", 55_200.00, "INR", "draft",         None),
        ("PO-2026-0023", "Chroma ATE",                "RFQ-2026-031", 1_980_000.00, "INR", "acknowledged","2026-07-05"),
        ("PO-2026-0024", "Eaton Power Quality",       None,           29_400.00, "INR", "received",     "2026-04-28"),
        ("PO-2026-0025", "Belden Cables",             "RFQ-2026-032", 17_800.00, "INR", "issued",       "2026-06-09"),
        ("PO-2026-0026", "Murata Power Solutions",    "RFQ-2026-033", 8_400.00, "USD", "shipped",        "2026-05-31"),
        ("PO-2026-0027", "Festo Pneumatics",          "RFQ-2026-034", 62_500.00, "INR", "issued",       "2026-06-17"),
    ]
    # Reverse so the lowest-numbered PO is the oldest (created_at increases
    # left-to-right), which makes the default "newest first" listing match
    # the natural top-of-ledger ordering.
    now = time.time()
    for i, (num, vendor, rfq, total, ccy, status, eta) in enumerate(reversed(seeds)):
        po = _PO(
            id=f"PO-{uuid.uuid4().hex[:8].upper()}",
            po_number=num,
            vendor=vendor,
            rfq_ref=rfq,
            total=total,
            currency=ccy,
            status=status,  # type: ignore[arg-type]
            eta=eta,
            created_at=now - (len(seeds) - i) * 3600,
            updated_at=now - (len(seeds) - i) * 1800,
        )
        store._items[po.id] = po


# Seed unless we are running under pytest — tests start from an empty store.
if "PYTEST_CURRENT_TEST" not in os.environ and not os.environ.get("AGNI_TEST_MODE"):
    _seed_demo()
