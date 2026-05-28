"""IEC TS 60904-13 — Electroluminescence imaging verdict (DEMO-only).
INCONCLUSIVE stub: thresholds unsigned — owner to sign before grading.
"""
from __future__ import annotations

from typing import Mapping

from .base import Verdict, VerdictStatus
from .registry import register

CLAUSE = "IEC TS 60904-13"
CLAUSE_TEXT = "TODO — owner to sign thresholds for EL"


@register("el")
def evaluate(data: Mapping[str, float]) -> Verdict:
    return Verdict(VerdictStatus.INCONCLUSIVE, CLAUSE, CLAUSE_TEXT,
                   measured=None, threshold=None, margin=None, evidence_refs=[])
