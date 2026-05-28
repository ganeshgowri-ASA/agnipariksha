"""Verdict value object, Evaluator protocol, and shared dPmax factory (DEMO-only)."""
from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Mapping, Optional, Protocol, runtime_checkable

from ..iec_pass_fail import AnalysisResult, Verdict as _Legacy, pmax_delta_verdict

class VerdictStatus(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    INCONCLUSIVE = "INCONCLUSIVE"

@dataclass(frozen=True)
class Verdict:
    status: VerdictStatus
    clause_id: str
    clause_text: str
    measured: Optional[float]
    threshold: float
    margin: Optional[float]
    evidence_refs: List[str] = field(default_factory=list)

@runtime_checkable
class Evaluator(Protocol):
    def __call__(self, data: Mapping[str, float]) -> Verdict: ...

_STATUS = {_Legacy.PASS: VerdictStatus.PASS, _Legacy.FAIL: VerdictStatus.FAIL}

def from_pmax(result: AnalysisResult, *, clause_id: str, clause_text: str,
              threshold: float, evidence: Optional[List[str]] = None) -> Verdict:
    status = _STATUS.get(result.verdict, VerdictStatus.INCONCLUSIVE)
    margin = None if result.metric is None else round(result.metric - threshold, 4)
    return Verdict(status, clause_id, clause_text, result.metric, threshold, margin, evidence or [])

def pmax_evaluator(clause_id: str, clause_text: str, *, threshold: float = -5.0) -> Evaluator:
    """dPmax-only evaluator shared by HF/PID/LeTID."""
    def _ev(data: Mapping[str, float]) -> Verdict:
        res = pmax_delta_verdict(float(data.get("pre_pmax_w", 0.0)),
                                 float(data.get("post_pmax_w", 0.0)),
                                 threshold_pct=threshold, clause=clause_id)
        return from_pmax(res, clause_id=clause_id, clause_text=clause_text, threshold=threshold)
    return _ev
