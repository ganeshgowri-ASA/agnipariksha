"""IEC 61730-2 MST 26 — Reverse Current Overload verdict (DEMO-only).
INCONCLUSIVE stub: thresholds unsigned — owner to sign before grading.
"""
from __future__ import annotations

from typing import Mapping

from .base import Verdict, VerdictStatus
from .registry import register

CLAUSE = "IEC 61730-2 MST 26"
CLAUSE_TEXT = "TODO — owner to sign thresholds for RCOT"


@register("rcot")
def evaluate(data: Mapping[str, float]) -> Verdict:
    return Verdict(VerdictStatus.INCONCLUSIVE, CLAUSE, CLAUSE_TEXT,
                   measured=None, threshold=None, margin=None, evidence_refs=[])
