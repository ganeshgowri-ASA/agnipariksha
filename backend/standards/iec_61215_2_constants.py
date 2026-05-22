"""Canonical constants from IEC 61215-2 Edition 2.0 (2021-02).

This module is the single source of truth for the numeric limits, dwell
times, currents, and durations that every PV-module reliability test
orchestrator in Agnipariksha relies on. It encodes values defined in
IEC 61215-2 Edition 2.0 (2021-02) (Module Qualification Tests, "MQT")
and the closely related IEC 61730-2 mechanical/safety tests and
IEC TS 62804-1 PID test referenced by the IEC 61215 suite.

All values are EXACT as written in the published standard — do NOT
"round" or "tune" them. If the standard is revised, bump
``STANDARD_EDITION`` and update this module in a dedicated PR.

Units appear in every variable name (``_C``, ``_PCT``, ``_H``, ``_MIN``,
``_MS``, ``_A``, ``_OHM``, ``_FRAC_ISC``) so callers cannot guess wrong.
"""

from __future__ import annotations

from typing import Final

STANDARD_EDITION: Final[str] = "IEC 61215-2 Edition 2.0 (2021-02)"


# ---------------------------------------------------------------------------
# TC — MQT 11 Thermal Cycling (IEC 61215-2 §4.11)
# ---------------------------------------------------------------------------
# Temperature window, ramp rate ceiling, dwell floor and per-cycle time cap
# defining one TC profile. Heat-up draws Isc (Imp in practice ~= Isc here);
# cool-down current must drop to near zero per the standard.
TC_T_LOW_C: Final[float] = -40.0
TC_T_HIGH_C: Final[float] = 85.0
TC_MAX_RAMP_C_PER_HOUR: Final[float] = 100.0
TC_MIN_DWELL_MIN: Final[float] = 10.0
TC_MAX_CYCLE_HOURS: Final[float] = 6.0
TC_CURRENT_HEATUP_FRAC_ISC: Final[float] = 1.0
TC_CURRENT_COOLDOWN_FRAC_ISC_MAX: Final[float] = 0.01


# ---------------------------------------------------------------------------
# HF — MQT 12 Humidity Freeze (IEC 61215-2 §4.12)
# ---------------------------------------------------------------------------
# 10 cycles between -40 C and +85 C / 85 %RH. No appreciable forward bias —
# leakage current must stay below 0.5 %Isc with a 100 mA absolute floor.
HF_T_LOW_C: Final[float] = -40.0
HF_T_HIGH_C: Final[float] = 85.0
HF_RH_HIGH_PCT: Final[float] = 85.0
HF_CYCLES: Final[int] = 10
HF_CURRENT_FRAC_ISC_MAX: Final[float] = 0.005
HF_CURRENT_FLOOR_MA: Final[float] = 100.0


# ---------------------------------------------------------------------------
# DH — MQT 13 Damp Heat (IEC 61215-2 §4.13)
# ---------------------------------------------------------------------------
# 1000 h soak at 85 C / 85 %RH.
DH_TEMP_C: Final[float] = 85.0
DH_RH_PCT: Final[float] = 85.0
DH_DURATION_H: Final[float] = 1000.0


# ---------------------------------------------------------------------------
# BPDT — MQT 18 Bypass Diode Thermal Test (IEC 61215-2 §4.18)
# ---------------------------------------------------------------------------
# Junction-temperature characterisation sweep, then 1 h at 75 C with
# 1.25 x Isc. Reverse-recovery pulse width is bounded.
BPDT_TJ_CHARACTERIZATION_C: Final[list[float]] = [30.0, 50.0, 70.0, 90.0]
BPDT_TEST_TEMP_C: Final[float] = 75.0
BPDT_TEST_DURATION_H: Final[float] = 1.0
BPDT_CURRENT_MULTIPLIER: Final[float] = 1.25
BPDT_PULSE_WIDTH_MS_MAX: Final[float] = 1.0


# ---------------------------------------------------------------------------
# PID — IEC TS 62804-1 (referenced by IEC 61215-2 for PID screening)
# ---------------------------------------------------------------------------
# 96 h stress at 85 C / 85 %RH, two samples per polarity (positive and
# negative system-voltage bias) per the technical specification.
PID_TEMP_C: Final[float] = 85.0
PID_RH_PCT: Final[float] = 85.0
PID_DURATION_H: Final[float] = 96.0
PID_SAMPLE_COUNT_PER_POLARITY: Final[int] = 2


# ---------------------------------------------------------------------------
# GCT — Ground Continuity Test (IEC 61730-2 §5.3.2 / MST 13)
# ---------------------------------------------------------------------------
# Inject 25 A AC/DC; resistance between any exposed metal and the
# grounding point must be below 0.1 ohm.
GCT_TEST_CURRENT_A: Final[float] = 25.0
GCT_MAX_RESISTANCE_OHM: Final[float] = 0.1


# ---------------------------------------------------------------------------
# RCOT — Reverse Current Overload Test (IEC 61730-2 MST 26)
# ---------------------------------------------------------------------------
# Drive 1.35 x OCPD rating through the module for 2 h.
RCOT_OCPD_MULTIPLIER: Final[float] = 1.35
RCOT_DURATION_H: Final[float] = 2.0
