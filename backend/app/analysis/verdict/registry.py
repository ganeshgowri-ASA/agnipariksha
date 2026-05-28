"""Registry mapping test_type -> Evaluator."""
from __future__ import annotations
from typing import Callable, Dict
from .base import Evaluator

_REGISTRY: Dict[str, Evaluator] = {}

def register(test_type: str) -> Callable[[Evaluator], Evaluator]:
    def deco(fn: Evaluator) -> Evaluator:
        _REGISTRY[test_type] = fn
        return fn
    return deco

def get(test_type: str) -> Evaluator:
    if test_type not in _REGISTRY:
        raise KeyError(test_type)
    return _REGISTRY[test_type]

def all_evaluators() -> Dict[str, Evaluator]:
    return dict(_REGISTRY)
