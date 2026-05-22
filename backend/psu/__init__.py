"""PSU driver abstraction for Agnipariksha.

This package introduces a vendor-neutral ABC (``PSUDriver``) plus a
module-level registry, so test routines can target the abstract
contract instead of an ITech-specific class.

The legacy ``backend.scpi_driver.SCPIDriver`` symbol remains importable
as a thin alias of :class:`backend.psu.itech.ITechPV6000Driver`.
"""
from __future__ import annotations

from .base import PSUDriver
from .registry import get_driver, list_drivers, register_driver

# Import vendor modules so their @register_driver side-effects run.
from . import itech  # noqa: F401  (side-effect: registers "itech_pv6000")

__all__ = [
    "PSUDriver",
    "get_driver",
    "list_drivers",
    "register_driver",
]
