"""Analysis routines for IEC 61215-2 MQT 18 bypass diode thermal test.

Pure-functional math (no I/O, no asyncio) so it is trivial to unit test.

Two computations matter:

1. ``linear_fit``: ordinary least-squares fit of Vf = m * T + c with the
   coefficient of determination R^2. Used by Phase A to characterise
   each diode's temperature coefficient. No third-party dependency
   (numpy) is required so the analysis works on a minimal Python install.

2. ``junction_temperature``: invert the calibration to recover Tj from a
   measured Vf during the 1 h current bias of Phase B.

The pass/fail helper (``evaluate``) collects the per-diode Tj, compares
against the datasheet ``Tj_max`` with a configurable margin, and returns
a structured verdict suitable for direct JSON serialisation in the
report and the websocket telemetry payload.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Iterable, Sequence


@dataclass(frozen=True)
class LinearFit:
    """OLS fit of y = slope * x + intercept."""

    slope: float          # mV/C when used with Vf in mV, V/C when Vf in V
    intercept: float
    r_squared: float
    n: int

    def to_dict(self) -> dict:
        return asdict(self)


def linear_fit(xs: Sequence[float], ys: Sequence[float]) -> LinearFit:
    """Least-squares fit of y = m*x + c.

    Raises ``ValueError`` if fewer than two points or if all xs are equal
    (the slope would be undefined). The R^2 collapses to 0.0 when the
    ys have zero variance — by convention we report a perfect fit (1.0)
    in that degenerate-but-not-erroneous case.
    """
    if len(xs) != len(ys):
        raise ValueError("xs and ys must have the same length")
    n = len(xs)
    if n < 2:
        raise ValueError("need at least two points to fit a line")

    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    sxx = sum((x - mean_x) ** 2 for x in xs)
    sxy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    syy = sum((y - mean_y) ** 2 for y in ys)

    if sxx == 0.0:
        raise ValueError("xs have zero variance; slope is undefined")

    slope = sxy / sxx
    intercept = mean_y - slope * mean_x

    if syy == 0.0:
        # Flat ys, slope necessarily 0; report a 'perfect' fit.
        r_squared = 1.0
    else:
        ss_res = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(xs, ys))
        r_squared = max(0.0, 1.0 - ss_res / syy)

    return LinearFit(slope=slope, intercept=intercept, r_squared=r_squared, n=n)


def junction_temperature(vf_hot: float, fit: LinearFit) -> float:
    """Recover Tj from a Vf measurement using the diode's calibration line.

    Vf = m*T + c  =>  T = (Vf - c) / m.

    The slope is negative for any real Si diode, so a non-negative slope
    is rejected to surface a bad calibration immediately.
    """
    if fit.slope == 0.0:
        raise ValueError("calibration slope is zero; cannot invert")
    if fit.slope > 0.0:
        raise ValueError(
            "calibration slope is positive; expected negative dVf/dT for a Si diode"
        )
    return (vf_hot - fit.intercept) / fit.slope


@dataclass(frozen=True)
class DiodeVerdict:
    diode_id: str
    part_number: str
    tj_c: float
    tj_max_c: float
    margin_c: float
    headroom_c: float          # tj_max - margin - tj  (positive = pass)
    passed: bool
    r_squared: float

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class TestVerdict:
    passed: bool
    diodes: list                # list[DiodeVerdict]
    failing_diode_ids: list     # list[str]
    summary: str

    def to_dict(self) -> dict:
        return {
            "passed": self.passed,
            "diodes": [d.to_dict() for d in self.diodes],
            "failing_diode_ids": list(self.failing_diode_ids),
            "summary": self.summary,
        }


def evaluate(
    diodes: Iterable[dict],
    *,
    margin_c: float = 10.0,
) -> TestVerdict:
    """Roll up per-diode Tj measurements into a pass/fail verdict.

    Each entry in ``diodes`` must contain ``diode_id``, ``part_number``,
    ``tj_c``, ``tj_max_c`` and ``r_squared``. Missing keys raise
    ``KeyError`` so caller bugs are loud rather than silently passing.
    """
    if margin_c < 0:
        raise ValueError("margin_c must be non-negative")

    verdicts: list = []
    failing: list = []
    for d in diodes:
        tj = float(d["tj_c"])
        tj_max = float(d["tj_max_c"])
        headroom = tj_max - margin_c - tj
        passed = headroom >= 0.0
        v = DiodeVerdict(
            diode_id=str(d["diode_id"]),
            part_number=str(d["part_number"]),
            tj_c=tj,
            tj_max_c=tj_max,
            margin_c=margin_c,
            headroom_c=headroom,
            passed=passed,
            r_squared=float(d["r_squared"]),
        )
        verdicts.append(v)
        if not passed:
            failing.append(v.diode_id)

    all_pass = len(failing) == 0
    if all_pass:
        summary = (
            f"All {len(verdicts)} diodes pass: Tj <= Tj_max - {margin_c:.1f} C margin."
        )
    else:
        summary = (
            f"{len(failing)}/{len(verdicts)} diodes exceeded Tj_max - {margin_c:.1f} C: "
            + ", ".join(failing)
        )
    return TestVerdict(
        passed=all_pass,
        diodes=verdicts,
        failing_diode_ids=failing,
        summary=summary,
    )


def functionality_ok(
    vf_at_25c: float,
    *,
    fit: LinearFit,
    tolerance_v: float = 0.15,
) -> bool:
    """Phase C check: at 25 C and the test current, the diode must conduct
    with a Vf within ``tolerance_v`` of the calibration prediction.

    An open diode (Vf >> expected) or a short (Vf ~ 0) both fall outside
    the band. A negative tolerance is rejected.
    """
    if tolerance_v <= 0:
        raise ValueError("tolerance_v must be positive")
    expected = fit.slope * 25.0 + fit.intercept
    return abs(vf_at_25c - expected) <= tolerance_v
