"""IV-curve acquisition modes.

- Offline import (CSV / XLSX) via :mod:`backend.iv.importer` — no hardware.
- PSU + Scope live acquisition via :mod:`backend.iv.psu_scope`.
"""
from .importer import router

__all__ = ["router"]
