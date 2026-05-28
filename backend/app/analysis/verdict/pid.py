"""IEC TS 62804-1 — Potential-Induced Degradation verdict (DEMO-only)."""
from __future__ import annotations
from .base import pmax_evaluator
from .registry import register

CLAUSE = "IEC TS 62804-1"
CLAUSE_TEXT = "PID, 96 h @ -1500 V / 85 C / 85% RH: dPmax >= -5%"

evaluate = register("pid")(pmax_evaluator(CLAUSE, CLAUSE_TEXT))
