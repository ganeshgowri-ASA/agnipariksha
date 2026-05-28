# Tab-4 Analysis Verdict Engine HTTP surface (DEMO-only):
#   POST /api/analysis/recompute — grade a run, persist the verdict.
#   GET  /api/analysis/{run_id}  — return the latest persisted verdict.
# Omit ``metrics`` to grade deterministic run_id-seeded synthetic data.
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import select

try:
    from ..analysis.verdict import get as get_evaluator
    from ..analysis.verdict.registry import all_evaluators
    from ...db.models import AnalysisVerdict
    from ...db.session import get_session
except ImportError:  # pragma: no cover - script-mode fallback
    from app.analysis.verdict import get as get_evaluator  # type: ignore[no-redef]
    from app.analysis.verdict.registry import all_evaluators  # type: ignore[no-redef]
    from db.models import AnalysisVerdict  # type: ignore[no-redef]
    from db.session import get_session  # type: ignore[no-redef]

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


class RecomputeReq(BaseModel):
    run_id: str = Field(..., min_length=1, max_length=128)
    test_type: str = Field(..., min_length=1, max_length=32)
    metrics: Optional[Dict[str, float]] = None

_FIELDS = ("run_id", "test_type", "status", "clause_id", "clause_text",
           "measured", "threshold", "margin")

def _demo_metrics(test_type: str, run_id: str) -> Dict[str, float]:
    """Deterministic synthetic metrics seeded by run_id — DEMO only."""
    seed = int(hashlib.sha256(f"{test_type}:{run_id}".encode()).hexdigest(), 16)
    pre = 300.0
    m = {"pre_pmax_w": pre, "post_pmax_w": round(pre * (1 - (seed % 700) / 10000.0), 3)}
    if test_type == "tc":
        m["insulation_resistance_mohm_m2"] = 40.0 + (seed % 20)
    return m

def _dump(row: AnalysisVerdict) -> dict:
    computed = row.computed_at or datetime.now(timezone.utc)
    d = {f: getattr(row, f) for f in _FIELDS}
    d["evidence_refs"] = list(row.evidence_refs or [])
    d["computed_at"] = computed.isoformat()
    return d

@router.post("/recompute")
def recompute(req: RecomputeReq) -> dict:
    try:
        evaluator = get_evaluator(req.test_type)
    except KeyError:
        raise HTTPException(404, {"error": "unknown_test_type", "test_type": req.test_type,
                                  "known": sorted(all_evaluators())})
    data = req.metrics if req.metrics is not None else _demo_metrics(req.test_type, req.run_id)
    v = evaluator(data)
    row = AnalysisVerdict(
        run_id=req.run_id, test_type=req.test_type, status=v.status.value,
        clause_id=v.clause_id, clause_text=v.clause_text, measured=v.measured,
        threshold=v.threshold, margin=v.margin, evidence_refs=list(v.evidence_refs))
    with get_session() as s:
        s.add(row)
        s.commit()
        s.refresh(row)
        return _dump(row)

@router.get("/{run_id}")
def latest(run_id: str) -> dict:
    with get_session() as s:
        row = s.exec(
            select(AnalysisVerdict).where(AnalysisVerdict.run_id == run_id)
            .order_by(AnalysisVerdict.id.desc())
        ).first()
    if row is None:
        raise HTTPException(404, {"error": "no_verdict", "run_id": run_id})
    return _dump(row)
