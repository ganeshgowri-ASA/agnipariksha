"""IEC pass/fail analysis for PV module reliability tests.

This package mirrors the verdict logic exposed by the frontend
``AnalysisPanel`` so it can be exercised by the backend pytest harness
against the IEC fixtures in ``backend/tests/test_analysis.py``.

The frontend computes ΔPmax in the browser for live UI feedback; the
canonical pass/fail boundary lives here so it can also be invoked from
server-side report generation, the MCP tool surface, and CI checks.
"""
from .iec_pass_fail import (
    AnalysisResult,
    Reading,
    Verdict,
    GATE2_PMAX_DELTA_PERCENT,
    bypass_diode_verdict,
    ground_continuity_verdict,
    letid_verdict,
    pmax_delta_verdict,
    reverse_current_verdict,
)

__all__ = [
    "AnalysisResult",
    "GATE2_PMAX_DELTA_PERCENT",
    "Reading",
    "Verdict",
    "bypass_diode_verdict",
    "ground_continuity_verdict",
    "letid_verdict",
    "pmax_delta_verdict",
    "reverse_current_verdict",
]
