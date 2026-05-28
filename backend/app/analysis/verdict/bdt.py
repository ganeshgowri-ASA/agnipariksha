"""IEC 61215 BDT — Bypass Diode Thermal verdict (DEMO-only).
INCONCLUSIVE stub: thresholds unsigned — owner to sign before grading.
"""
from __future__ import annotations

from typing import Mapping

from .base import Verdict, VerdictStatus
from .registry import register

CLAUSE = "IEC 61215 BDT"
CLAUSE_TEXT = "TODO — owner to sign thresholds for BDT"


@register("bdt")
def evaluate(data: Mapping[str, float]) -> Verdict:
    return Verdict(VerdictStatus.INCONCLUSIVE, CLAUSE, CLAUSE_TEXT,
                   measured=None, threshold=None, margin=None, evidence_refs=[])
