"""Module-level driver registry.

Vendor modules register themselves at import time, e.g. ::

    from .registry import register_driver
    register_driver("itech_pv6000", ITechPV6000Driver)

Callers can then look up drivers by ``make`` key without importing the
vendor module directly.
"""
from __future__ import annotations

from typing import Dict, List, Type

from .base import PSUDriver

_REGISTRY: Dict[str, Type[PSUDriver]] = {}


def register_driver(make: str, cls: Type[PSUDriver]) -> None:
    """Register a concrete :class:`PSUDriver` subclass under ``make``.

    Re-registering the same key replaces the previous entry - this
    keeps test isolation simple (tests can register/replace shims).
    """
    if not isinstance(make, str) or not make:
        raise ValueError("make must be a non-empty string")
    if not isinstance(cls, type) or not issubclass(cls, PSUDriver):
        raise TypeError(
            f"{cls!r} is not a PSUDriver subclass - refusing to register"
        )
    _REGISTRY[make] = cls


def get_driver(make: str) -> Type[PSUDriver]:
    """Return the driver class registered under ``make``.

    Raises ``KeyError`` with a helpful message listing the known drivers
    so misconfiguration is easy to diagnose.
    """
    try:
        return _REGISTRY[make]
    except KeyError as exc:
        known = ", ".join(sorted(_REGISTRY)) or "<none>"
        raise KeyError(
            f"Unknown PSU driver {make!r}. Registered drivers: {known}"
        ) from exc


def list_drivers() -> List[str]:
    """Return a sorted list of registered driver keys."""
    return sorted(_REGISTRY)
