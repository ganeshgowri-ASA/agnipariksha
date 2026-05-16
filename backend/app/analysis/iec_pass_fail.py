"""IEC pass/fail verdict helpers for each MQT / MST clause.

The frontend ``AnalysisPanel`` evaluates ΔPmax against
``GATE2_PMAX_DELTA_PERCENT`` (-5%). The same constant is re-exported
here so backend report generation and the pytest harness share the
identical threshold and never drift.

Standards referenced:
  * IEC 61215-2 MQT 11 — Thermal Cycling
  * IEC 61215-2 MQT 12 — Humidity Freeze
  * IEC 61215-2 MQT 13 — Damp Heat
  * IEC TS 63342:2022   — LeTID
  * IEC 62979:2017      — Bypass Diode Thermal
  * IEC 61730-2 MST 13  — Ground Continuity
  * IEC 61730-2 MST 26  — Reverse Current Overload
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Iterable, Optional


# Mirrors GATE2_PMAX_DELTA_PERCENT in frontend/types/test-session.ts.
GATE2_PMAX_DELTA_PERCENT: float = -5.0


class Verdict(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"


@dataclass(frozen=True)
class Reading:
    """Single telemetry sample.

    Matches the ``LiveReading`` shape used by the frontend hook so a
    JSON payload from /ws/telemetry can be ingested unchanged.
    """

    timestamp_ms: int
    voltage: float
    current: float
    power: float
    temperature: Optional[float] = None


@dataclass(frozen=True)
class AnalysisResult:
    """Outcome of a single IEC verdict computation."""

    verdict: Verdict
    metric: Optional[float]
    threshold: float
    clause: str
    notes: str = ""

    @property
    def passed(self) -> bool:
        return self.verdict is Verdict.PASS

    @property
    def failed(self) -> bool:
        return self.verdict is Verdict.FAIL


# ---------------------------------------------------------------------------
# Pmax-delta verdicts — TC / HF / DH / LeTID all share this shape with
# different thresholds.
# ---------------------------------------------------------------------------

def pmax_delta_verdict(
    pre_pmax_w: float,
    post_pmax_w: float,
    *,
    threshold_pct: float = GATE2_PMAX_DELTA_PERCENT,
    clause: str = "IEC 61215-2 MQT 11",
) -> AnalysisResult:
    """Generic ΔPmax verdict.

    ``threshold_pct`` is the lower bound on permitted relative change.
    e.g. ``-5.0`` means ``post`` may not drop more than 5% below ``pre``
    (PASS when ``delta_pct >= threshold_pct``).
    """
    if pre_pmax_w <= 0:
        return AnalysisResult(
            verdict=Verdict.INSUFFICIENT_DATA,
            metric=None,
            threshold=threshold_pct,
            clause=clause,
            notes="pre_pmax_w must be > 0",
        )
    delta_pct = ((post_pmax_w - pre_pmax_w) / pre_pmax_w) * 100.0
    return AnalysisResult(
        verdict=Verdict.PASS if delta_pct >= threshold_pct else Verdict.FAIL,
        metric=delta_pct,
        threshold=threshold_pct,
        clause=clause,
        notes=f"ΔPmax = {delta_pct:.3f}% vs threshold {threshold_pct:.3f}%",
    )


def letid_verdict(
    pre_pmax_w: float,
    post_pmax_w: float,
    *,
    threshold_pct: float = -2.0,
    clause: str = "IEC TS 63342:2022",
) -> AnalysisResult:
    """LeTID has a tighter Pmax-loss budget (2%) than the MQT family."""
    return pmax_delta_verdict(
        pre_pmax_w,
        post_pmax_w,
        threshold_pct=threshold_pct,
        clause=clause,
    )


# ---------------------------------------------------------------------------
# Time-series verdicts — work directly on a sequence of Reading samples.
# ---------------------------------------------------------------------------

def ground_continuity_verdict(
    readings: Iterable[Reading],
    *,
    max_resistance_ohm: float = 0.1,
    clause: str = "IEC 61730-2 MST 13",
) -> AnalysisResult:
    """Ground continuity: R = V/I must stay ≤ 0.1 Ω at every sample."""
    valid = [r for r in readings if r.current > 0]
    if not valid:
        return AnalysisResult(
            verdict=Verdict.INSUFFICIENT_DATA,
            metric=None,
            threshold=max_resistance_ohm,
            clause=clause,
            notes="no readings with current > 0",
        )
    max_r = max(r.voltage / r.current for r in valid)
    return AnalysisResult(
        verdict=Verdict.PASS if max_r <= max_resistance_ohm else Verdict.FAIL,
        metric=max_r,
        threshold=max_resistance_ohm,
        clause=clause,
        notes=f"max R = {max_r:.4f} Ω vs threshold ≤ {max_resistance_ohm:.4f} Ω",
    )


def bypass_diode_verdict(
    readings: Iterable[Reading],
    *,
    max_junction_temp_c: float = 128.0,
    clause: str = "IEC 62979:2017",
) -> AnalysisResult:
    """BDT: peak junction temperature must remain ≤ 128°C (no runaway)."""
    temps = [r.temperature for r in readings if r.temperature is not None]
    if not temps:
        return AnalysisResult(
            verdict=Verdict.INSUFFICIENT_DATA,
            metric=None,
            threshold=max_junction_temp_c,
            clause=clause,
            notes="no temperature samples",
        )
    peak = max(temps)
    return AnalysisResult(
        verdict=Verdict.PASS if peak <= max_junction_temp_c else Verdict.FAIL,
        metric=peak,
        threshold=max_junction_temp_c,
        clause=clause,
        notes=f"peak Tj = {peak:.2f}°C vs threshold ≤ {max_junction_temp_c:.2f}°C",
    )


def reverse_current_verdict(
    readings: Iterable[Reading],
    *,
    test_current_a: float,
    tolerance_pct: float = 5.0,
    clause: str = "IEC 61730-2 MST 26",
) -> AnalysisResult:
    """RCO: measured current must stay within tolerance of test current.

    The reverse-current test applies 1.35×Isc; the harness FAILs if the
    measured current exceeds ``test_current_a * (1 + tolerance_pct/100)``
    (indicating an unexpected runaway / arc condition).
    """
    samples = list(readings)
    if not samples:
        return AnalysisResult(
            verdict=Verdict.INSUFFICIENT_DATA,
            metric=None,
            threshold=test_current_a,
            clause=clause,
            notes="no readings",
        )
    upper = test_current_a * (1.0 + tolerance_pct / 100.0)
    max_i = max(r.current for r in samples)
    return AnalysisResult(
        verdict=Verdict.PASS if max_i <= upper else Verdict.FAIL,
        metric=max_i,
        threshold=upper,
        clause=clause,
        notes=f"max I = {max_i:.3f} A vs upper bound ≤ {upper:.3f} A",
    )
