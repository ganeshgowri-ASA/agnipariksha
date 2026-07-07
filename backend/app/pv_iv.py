"""Single-diode PV module I-V model for the DEMO solar-array-simulator mode.

The ITECH PV6000 is a *PV array simulator*: it sources current along a
module's I-V curve rather than acting as a plain bench supply. In DEMO we
emulate that curve so an operator can exercise the full "power supply
connected to a PV module" workflow — pick an operating voltage, watch the
current ride the curve, find the maximum-power point — without energizing
any hardware. LIVE hardware energization stays gated elsewhere.

Uses the classic explicit (non-iterative) PV model that passes through the
three datasheet points (0, Isc), (Vmp, Imp) and (Voc, 0):

    C2 = (Vmp/Voc - 1) / ln(1 - Imp/Isc)
    C1 = (1 - Imp/Isc) * exp(-Vmp / (C2*Voc))
    I(V) = Isc * (1 - C1 * (exp(V / (C2*Voc)) - 1))
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Tuple


@dataclass(frozen=True)
class PvModule:
    """PV module datasheet points at the chosen irradiance/temperature.

    Defaults model a typical 60-cell crystalline-silicon module at STC.
    """

    name: str = "Generic 60-cell c-Si @ STC"
    isc: float = 9.5   # A, short-circuit current
    voc: float = 40.0  # V, open-circuit voltage
    imp: float = 9.0   # A, current at maximum power
    vmp: float = 32.0  # V, voltage at maximum power

    def validate(self) -> None:
        if not (0 < self.imp < self.isc):
            raise ValueError("require 0 < Imp < Isc")
        if not (0 < self.vmp < self.voc):
            raise ValueError("require 0 < Vmp < Voc")


def pv_current(v: float, m: PvModule) -> float:
    """Module current at operating voltage ``v`` (A), clamped to [0, Isc]."""
    m.validate()
    if v <= 0.0:
        return m.isc
    if v >= m.voc:
        return 0.0
    c2 = (m.vmp / m.voc - 1.0) / math.log(1.0 - m.imp / m.isc)
    c1 = (1.0 - m.imp / m.isc) * math.exp(-m.vmp / (c2 * m.voc))
    i = m.isc * (1.0 - c1 * (math.exp(v / (c2 * m.voc)) - 1.0))
    return max(0.0, min(m.isc, i))


def iv_curve(m: PvModule, points: int = 41) -> List[Tuple[float, float, float]]:
    """Sampled curve as ``(v, i, p)`` triples from 0 V to Voc."""
    if points < 2:
        points = 2
    out: List[Tuple[float, float, float]] = []
    for k in range(points):
        v = m.voc * k / (points - 1)
        i = pv_current(v, m)
        out.append((round(v, 4), round(i, 4), round(v * i, 4)))
    return out


def max_power_point(m: PvModule, points: int = 201) -> Tuple[float, float, float]:
    """Numerically found MPP ``(v, i, p)`` — near the datasheet (Vmp, Imp)."""
    best = (0.0, m.isc, 0.0)
    for k in range(points):
        v = m.voc * k / (points - 1)
        i = pv_current(v, m)
        p = v * i
        if p > best[2]:
            best = (v, i, p)
    return (round(best[0], 4), round(best[1], 4), round(best[2], 4))
