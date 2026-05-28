# IEC TS 63342 — LeTID (DEMO-only). Reuses the shared dPmax helper; the
# dark-Voc moving-average lives in the frontend and is NOT re-implemented here.
from __future__ import annotations
from .base import pmax_evaluator
from .registry import register

CLAUSE = "IEC TS 63342"
CLAUSE_TEXT = "LeTID stabilization: dPmax >= -5%"

evaluate = register("letid")(pmax_evaluator(CLAUSE, CLAUSE_TEXT))
