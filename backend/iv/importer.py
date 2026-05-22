"""Offline IV-curve import — pure CSV/XLSX, no PSU interaction.

Endpoints
---------
- POST /api/iv/import                     multipart .csv or .xlsx
- GET  /api/iv/import/template/{csv|xlsx} starter template download

Required columns (canonical): V, I, T_module_c, irradiance_w_m2, timestamp.
Common lab-export header variants are normalised before validation —
``Voltage [V]`` → ``V``, ``Current [A]`` → ``I``,
``Temperature [°C]`` → ``T_module_c``, ``Irradiance [W/m^2]`` →
``irradiance_w_m2``, ``Time`` → ``timestamp``.
Optional form field ``area_m2`` (default 1.0) is used to compute eta.

Validation rejects on:
- missing columns
- empty rows
- NaN in any required cell
- non-monotonic V (sweep must be strictly increasing OR decreasing)
- malformed file (not parseable as CSV/XLSX)
"""
from __future__ import annotations

import io
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict

import numpy as np
import pandas as pd
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/iv", tags=["iv-import"])

REQUIRED_COLS = ("V", "I", "T_module_c", "irradiance_w_m2", "timestamp")
TEMPLATE_DIR = Path(__file__).resolve().parents[2] / "docs" / "templates"

# Common lab-export header variants → canonical column name.  Match is
# case-insensitive after stripping unit suffixes like "[V]" / "(W/m^2)".
COLUMN_ALIASES: Dict[str, str] = {
    "v": "V", "voltage": "V", "u": "V",
    "i": "I", "current": "I",
    "t": "T_module_c", "temperature": "T_module_c",
    "tmodule": "T_module_c", "t_module": "T_module_c",
    "t_module_c": "T_module_c", "module_temperature": "T_module_c",
    "irradiance": "irradiance_w_m2", "g": "irradiance_w_m2",
    "irradiance_w_m2": "irradiance_w_m2", "poa": "irradiance_w_m2",
    "timestamp": "timestamp", "time": "timestamp", "t_s": "timestamp",
    "datetime": "timestamp",
}

_runs: Dict[str, "ImportResult"] = {}


def _canonical(raw_name: str) -> str:
    """Strip unit suffix + whitespace, lowercase, look up alias."""
    s = str(raw_name).strip().lower()
    for sep in ("[", "("):
        if sep in s:
            s = s.split(sep, 1)[0].strip()
    s = s.replace(" ", "_").replace("-", "_").replace("/", "_")
    while "__" in s:
        s = s.replace("__", "_")
    return COLUMN_ALIASES.get(s, raw_name)


class ImportResult(BaseModel):
    run_id: str
    n_points: int
    Pmax_w: float
    Voc_v: float
    Isc_a: float
    Vmpp_v: float
    Impp_a: float
    FF: float
    eta: float
    irradiance_w_m2: float
    T_module_c_mean: float
    area_m2: float
    imported_at: datetime


def _read_table(filename: str, raw: bytes) -> pd.DataFrame:
    name = filename.lower()
    try:
        if name.endswith(".csv"):
            return pd.read_csv(io.BytesIO(raw))
        if name.endswith(".xlsx"):
            return pd.read_excel(io.BytesIO(raw), engine="openpyxl")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"unparseable file: {exc}")
    raise HTTPException(status_code=400, detail="file must be .csv or .xlsx")


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    renamed = {c: _canonical(c) for c in df.columns}
    return df.rename(columns=renamed)


def _validate(df: pd.DataFrame) -> None:
    missing = [c for c in REQUIRED_COLS if c not in df.columns]
    if missing:
        raise HTTPException(
            status_code=400, detail=f"missing columns: {missing}"
        )
    if df.empty:
        raise HTTPException(status_code=400, detail="empty IV curve")
    if len(df) < 2:
        raise HTTPException(
            status_code=400, detail="need >= 2 IV points to interpolate"
        )
    for c in ("V", "I", "T_module_c", "irradiance_w_m2"):
        col = pd.to_numeric(df[c], errors="coerce")
        if col.isna().any():
            raise HTTPException(
                status_code=400, detail=f"NaN or non-numeric in column {c}"
            )
        df[c] = col
    if df["timestamp"].isna().any():
        raise HTTPException(status_code=400, detail="NaN in timestamp")
    v = df["V"].to_numpy(dtype=float)
    diffs = np.diff(v)
    if not (np.all(diffs > 0) or np.all(diffs < 0)):
        raise HTTPException(
            status_code=400,
            detail="V must be strictly monotonic (increasing or decreasing)",
        )


def _interp_at(x: np.ndarray, y: np.ndarray, x_target: float) -> float:
    order = np.argsort(x)
    return float(np.interp(x_target, x[order], y[order]))


def _compute(df: pd.DataFrame, area_m2: float) -> ImportResult:
    v = df["V"].to_numpy(dtype=float)
    i = df["I"].to_numpy(dtype=float)
    p = v * i
    idx = int(np.argmax(p))
    Pmax = float(p[idx])
    Vmpp = float(v[idx])
    Impp = float(i[idx])
    Voc = _interp_at(i, v, 0.0)
    Isc = _interp_at(v, i, 0.0)
    FF = Pmax / (Voc * Isc) if (Voc * Isc) > 0 else 0.0
    G = float(df["irradiance_w_m2"].mean())
    eta = Pmax / (G * area_m2) if (G * area_m2) > 0 else 0.0
    T = float(df["T_module_c"].mean())
    run_id = uuid.uuid4().hex[:12]
    res = ImportResult(
        run_id=run_id,
        n_points=len(df),
        Pmax_w=round(Pmax, 6),
        Voc_v=round(Voc, 6),
        Isc_a=round(Isc, 6),
        Vmpp_v=round(Vmpp, 6),
        Impp_a=round(Impp, 6),
        FF=round(FF, 6),
        eta=round(eta, 6),
        irradiance_w_m2=round(G, 6),
        T_module_c_mean=round(T, 6),
        area_m2=area_m2,
        imported_at=datetime.now(timezone.utc),
    )
    _runs[run_id] = res
    return res


@router.post("/import", response_model=ImportResult)
async def import_iv(
    file: UploadFile = File(...),
    area_m2: float = Form(1.0),
) -> ImportResult:
    if not file.filename:
        raise HTTPException(status_code=400, detail="filename required")
    if area_m2 <= 0:
        raise HTTPException(status_code=400, detail="area_m2 must be > 0")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty upload")
    df = _normalize_columns(_read_table(file.filename, raw))
    _validate(df)
    return _compute(df, area_m2)


@router.get("/import/template/{fmt}")
def get_template(fmt: str) -> FileResponse:
    fmt = fmt.lower()
    if fmt not in ("csv", "xlsx"):
        raise HTTPException(
            status_code=400, detail="format must be 'csv' or 'xlsx'"
        )
    path = TEMPLATE_DIR / f"iv-import.{fmt}"
    if not path.exists():
        raise HTTPException(
            status_code=500, detail=f"template missing: {path.name}"
        )
    media = (
        "text/csv"
        if fmt == "csv"
        else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    return FileResponse(path, media_type=media, filename=path.name)


@router.get("/import/{run_id}", response_model=ImportResult)
def get_run(run_id: str) -> ImportResult:
    res = _runs.get(run_id)
    if res is None:
        raise HTTPException(status_code=404, detail="unknown run")
    return res
