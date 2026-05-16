"""REST router for the PV module catalogue.

Exposed under ``/api/modules``:
* GET  /              — list every registered module
* GET  /{id}          — single module nameplate lookup (404 if unknown)

The catalogue lives in process memory so the endpoint works in demo
deployments without TimescaleDB. When the DATABASE_URL points at a real
Postgres/Timescale instance the data is mirrored back from the
``modules`` table created by ``backend/database.py``.
"""
from __future__ import annotations

import os
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel


class ModuleNameplate(BaseModel):
    id: str
    model: Optional[str] = None
    manufacturer: Optional[str] = None
    pmax_w: Optional[float] = None
    voc_v: Optional[float] = None
    isc_a: Optional[float] = None
    vmpp_v: Optional[float] = None
    impp_a: Optional[float] = None


# Seed catalogue — three representative Indian PV manufacturers so the
# barcode scanner has known-good IDs to validate against in demo mode.
_SEED: Dict[str, ModuleNameplate] = {
    "MOD-2026-001": ModuleNameplate(
        id="MOD-2026-001",
        model="Vikram Solar Somera 540M",
        manufacturer="Vikram Solar",
        pmax_w=540.0,
        voc_v=49.5,
        isc_a=13.85,
        vmpp_v=41.6,
        impp_a=12.99,
    ),
    "MOD-2026-002": ModuleNameplate(
        id="MOD-2026-002",
        model="Adani ASMS-540-144M",
        manufacturer="Adani Solar",
        pmax_w=540.0,
        voc_v=49.7,
        isc_a=13.92,
        vmpp_v=41.5,
        impp_a=13.02,
    ),
    "MOD-2026-003": ModuleNameplate(
        id="MOD-2026-003",
        model="Waaree Aditya 545W",
        manufacturer="Waaree Energies",
        pmax_w=545.0,
        voc_v=49.8,
        isc_a=13.95,
        vmpp_v=41.7,
        impp_a=13.08,
    ),
}


class _ModuleStore:
    """Tiny in-memory store. Reads DATABASE_URL on first lookup so the
    Postgres mirror is best-effort; failures fall back to the seed."""

    def __init__(self) -> None:
        self._items: Dict[str, ModuleNameplate] = dict(_SEED)
        self._db_hydrated = False

    def _hydrate_from_db(self) -> None:
        if self._db_hydrated:
            return
        self._db_hydrated = True
        dsn = os.getenv("DATABASE_URL")
        if not dsn:
            return
        try:
            import psycopg2  # type: ignore[import-not-found]
            from psycopg2.extras import RealDictCursor  # type: ignore[import-not-found]
        except ImportError:
            return
        try:
            with psycopg2.connect(dsn) as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute(
                        "SELECT id, model, manufacturer, pmax_w, voc_v, "
                        "isc_a, vmpp_v, impp_a FROM modules"
                    )
                    for row in cur.fetchall():
                        item = ModuleNameplate(**row)
                        self._items[item.id] = item
        except Exception:
            # DB unreachable or schema missing — keep seed catalogue.
            return

    def get(self, module_id: str) -> Optional[ModuleNameplate]:
        self._hydrate_from_db()
        return self._items.get(module_id)

    def list(self) -> List[ModuleNameplate]:
        self._hydrate_from_db()
        return list(self._items.values())

    def upsert(self, m: ModuleNameplate) -> ModuleNameplate:
        self._items[m.id] = m
        return m

    def reset(self) -> None:
        self._items = dict(_SEED)
        self._db_hydrated = False


_store = _ModuleStore()


def get_store() -> _ModuleStore:
    return _store


router = APIRouter(prefix="/api/modules", tags=["modules"])


@router.get("", response_model=List[ModuleNameplate])
async def list_modules() -> List[ModuleNameplate]:
    return _store.list()


@router.get("/{module_id}", response_model=ModuleNameplate)
async def get_module(module_id: str) -> ModuleNameplate:
    item = _store.get(module_id.strip())
    if item is None:
        raise HTTPException(status_code=404, detail=f"module {module_id!r} not found")
    return item


@router.post("", response_model=ModuleNameplate, status_code=201)
async def register_module(payload: ModuleNameplate) -> ModuleNameplate:
    return _store.upsert(payload)
