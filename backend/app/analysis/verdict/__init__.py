"""Tab-4 Analysis Verdict Engine (DEMO-only); import registers all evaluators."""
from __future__ import annotations

from .base import Evaluator, Verdict, VerdictStatus
from .registry import all_evaluators, get, register
from . import tc, hf, pid, letid  # noqa: F401  (registration side effects)
from . import bdt, rcot, el, ir, gc, eq_bond  # noqa: F401  (PR-2 stub registration)

__all__ = ["Evaluator", "Verdict", "VerdictStatus", "all_evaluators", "get", "register"]
