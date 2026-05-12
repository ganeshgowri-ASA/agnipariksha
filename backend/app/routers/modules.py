"""CRUD for the Module entity."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..db import get_session
from ..models import Module

router = APIRouter(prefix="/api/modules", tags=["modules"])


class ModuleIn(BaseModel):
    manufacturer: str
    model: str
    technology: str = "mono-PERC"
    pmax_stc: float = 0.0
    voc: float = 0.0
    isc: float = 0.0
    vmpp: float = 0.0
    impp: float = 0.0
    bifaciality: float = 0.0
    area_m2: float = 0.0
    junction_box: str = ""
    bypass_diode_part: str = ""
    datasheet_url: str = ""
    notes: str = ""


class ModuleOut(ModuleIn):
    module_id: str
    created_at: str


def _to_out(m: Module) -> ModuleOut:
    return ModuleOut(
        module_id=m.module_id,
        manufacturer=m.manufacturer,
        model=m.model,
        technology=m.technology,
        pmax_stc=m.pmax_stc,
        voc=m.voc,
        isc=m.isc,
        vmpp=m.vmpp,
        impp=m.impp,
        bifaciality=m.bifaciality,
        area_m2=m.area_m2,
        junction_box=m.junction_box,
        bypass_diode_part=m.bypass_diode_part,
        datasheet_url=m.datasheet_url,
        notes=m.notes,
        created_at=m.created_at.isoformat(),
    )


@router.get("", response_model=list[ModuleOut])
def list_modules(s: Session = Depends(get_session)) -> list[ModuleOut]:
    rows = s.exec(select(Module).order_by(Module.created_at.desc())).all()
    return [_to_out(m) for m in rows]


@router.post("", response_model=ModuleOut, status_code=201)
def create_module(payload: ModuleIn, s: Session = Depends(get_session)) -> ModuleOut:
    m = Module(**payload.model_dump())
    s.add(m)
    s.commit()
    s.refresh(m)
    return _to_out(m)


@router.get("/{module_id}", response_model=ModuleOut)
def get_one(module_id: str, s: Session = Depends(get_session)) -> ModuleOut:
    m = s.get(Module, module_id)
    if not m:
        raise HTTPException(status_code=404, detail="module_not_found")
    return _to_out(m)


@router.delete("/{module_id}", status_code=204)
def delete_module(module_id: str, s: Session = Depends(get_session)) -> None:
    m = s.get(Module, module_id)
    if not m:
        raise HTTPException(status_code=404, detail="module_not_found")
    s.delete(m)
    s.commit()
