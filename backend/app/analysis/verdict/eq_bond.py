"""IEC 61730-1 5.3.4 — Equipotential Bonding verdict (DEMO-only).
INCONCLUSIVE stub: thresholds unsigned — owner to sign before grading.
"""
from __future__ import annotations

from typing import Mapping

from .base import Verdict, VerdictStatus
from .registry import register

CLAUSE = "IEC 61730-1 5.3.4"
CLAUSE_TEXT = "TODO — owner to sign thresholds for Eq-bond"


@register("eq_bond")
def evaluate(data: Mapping[str, float]) -> Verdict:
    return Verdict(VerdictStatus.INCONCLUSIVE, CLAUSE, CLAUSE_TEXT,
                   measured=None, threshold=None, margin=None, evidence_refs=[])
