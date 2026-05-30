"""PID stabilization conformity — IEC 61215-2 MQT 21 + IEC TS 62804-1.

MQT 21 stabilizes the module under system-voltage bias before the Pmax
measurement; the stabilization soak is operator-configurable in the 12–24 h
window. AFTER that window the chamber must hold T and RH inside the *tighter*
post-stabilization conformity bands (vs the wider tolerance tolerated mid-run
while the chamber is still settling). A breach of the post-stabilization band
is a hard NON-CONFORM verdict.

This is the backend mirror of
``frontend/features/pid/analysis/pidStabilization.ts`` — the constants, the
[12, 24] h clamp, and the conformity verdict MUST agree so the operator
dashboard and the bench never disagree about post-stab conformity. Update both
files together when the standard revisions land.
"""
from __future__ import annotations

import math

# MQT 21 — stabilization soak is configurable within this window (hours).
MIN_STABILIZATION_H = 12.0
MAX_STABILIZATION_H = 24.0

# Wider in-run tolerances — tolerated WHILE the chamber is settling (mirrors
# PID_CONSTANTS.T_TOL_C / RH_TOL_PCT). TS 62804-1 §6 environmental envelope.
T_TOL_WIDE_C = 2.0
RH_TOL_WIDE_PCT = 5.0

# Tighter post-stabilization tolerances — enforced AFTER the soak window
# closes, when T/RH must be held flat for the Pmax measurement.
# MQT 21 conformity / TS 62804-1 §6.2.
T_TOL_TIGHT_C = 1.0
RH_TOL_TIGHT_PCT = 3.0


def clamp_stabilization_hours(h: float) -> float:
    """Clamp the operator's stabilization-time input to the MQT 21 [12, 24] h window.

    The frontend already constrains the input field to [12, 24], but a
    misbehaving caller (CLI script, replay, etc.) could still pass a value
    outside the window. We clamp defensively — and fall back to the 12 h floor
    for NaN — so the bench never stabilizes for a non-compliant duration.
    """
    if math.isnan(h):
        return MIN_STABILIZATION_H
    return min(MAX_STABILIZATION_H, max(MIN_STABILIZATION_H, h))


def temp_conformity(meas_t: float | None, set_t: float) -> str:
    """Post-stabilization temperature conformity vs setpoint.

    Returns ``"conform"`` when ``|meas_t - set_t|`` is within the tight band
    (inclusive), ``"non-conform"`` otherwise, and ``"pending"`` with no reading.
    """
    if meas_t is None or math.isnan(meas_t):
        return "pending"
    return "conform" if abs(meas_t - set_t) <= T_TOL_TIGHT_C else "non-conform"


def rh_conformity(meas_rh: float | None, set_rh: float) -> str:
    """Post-stabilization humidity conformity vs setpoint.

    Returns ``"conform"`` when ``|meas_rh - set_rh|`` is within the tight band
    (inclusive), ``"non-conform"`` otherwise, and ``"pending"`` with no reading.
    """
    if meas_rh is None or math.isnan(meas_rh):
        return "pending"
    return "conform" if abs(meas_rh - set_rh) <= RH_TOL_TIGHT_PCT else "non-conform"


def stabilization_verdict(
    meas_t: float | None,
    set_t: float,
    meas_rh: float | None,
    set_rh: float,
) -> str:
    """Composite post-stabilization verdict using the tight tolerances.

    ``"pending"`` until BOTH T and RH have a reading; any tight-band breach on
    either axis is ``"non-conform"``; both inside their tight bands is
    ``"conform"``.
    """
    t = temp_conformity(meas_t, set_t)
    rh = rh_conformity(meas_rh, set_rh)
    if t == "pending" or rh == "pending":
        return "pending"
    if t == "non-conform" or rh == "non-conform":
        return "non-conform"
    return "conform"
