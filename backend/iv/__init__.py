"""Offline IV-curve import (CSV / XLSX).

NO hardware interaction: this module never touches the PSU or SCPI
transport. It accepts a tabular IV curve, validates it, and computes
Pmax / Voc / Isc / Vmpp / Impp / FF / eta in pure pandas + numpy.
"""
from .importer import router

__all__ = ["router"]
