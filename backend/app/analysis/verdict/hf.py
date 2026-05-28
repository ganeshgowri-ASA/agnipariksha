"""IEC 61215-2 MQT 13 — Humidity Freeze verdict (DEMO-only)."""
from __future__ import annotations
from .base import pmax_evaluator
from .registry import register

CLAUSE = "IEC 61215-2 MQT 13"
CLAUSE_TEXT = "Humidity freeze, 1000 h @ 85 C / 85% RH: dPmax >= -5%"

evaluate = register("hf")(pmax_evaluator(CLAUSE, CLAUSE_TEXT))
