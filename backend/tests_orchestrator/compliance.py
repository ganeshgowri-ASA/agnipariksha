"""IEC compliance validators.

Each validator returns a :class:`ComplianceResult` with a verdict and a
human-readable reason citing the specific clause that gave the verdict.
The validators consume the orchestrator's sample log, parameters, and
final state — they do not require live driver access.
"""
from __future__ import annotations

import math
import statistics
from typing import Iterable, Sequence

from .base import ComplianceResult, Sample


def _currents(samples: Sequence[Sample]) -> list[float]:
    return [s.current for s in samples]


def _voltages(samples: Sequence[Sample]) -> list[float]:
    return [s.voltage for s in samples]


def validate_thermal_cycling(
    samples: Sequence[Sample],
    *,
    cycles_completed: int,
    cycles_target: int,
    isc: float,
    current_tolerance: float = 0.10,
) -> ComplianceResult:
    """IEC 61215-2 MQT 11: 200 cycles, -40/+85 C, Isc injected hot phase.

    Clause 11.5 requires the full count of cycles. We additionally
    check that the injected current during heating phases was within
    +-10 % of Isc, as required for valid current injection.
    """
    standard = "IEC 61215-2 MQT 11"
    if cycles_completed < cycles_target:
        return ComplianceResult(
            standard=standard, passed=False,
            reason=f"Clause 11.5: only {cycles_completed}/{cycles_target} cycles completed",
            metrics={"cycles_completed": cycles_completed, "cycles_target": cycles_target},
        )

    hot = [s for s in samples if s.step.startswith("hot")]
    if not hot:
        return ComplianceResult(standard=standard, passed=False,
                                reason="no heating-phase samples recorded",
                                metrics={"hot_samples": 0})

    mean_i = statistics.fmean(_currents(hot))
    deviation = abs(mean_i - isc) / isc if isc else 1.0
    if deviation > current_tolerance:
        return ComplianceResult(
            standard=standard, passed=False,
            reason=(f"injected current {mean_i:.3f} A deviates "
                    f"{deviation*100:.1f}% from Isc={isc:.3f} A (>10%)"),
            metrics={"mean_hot_current": mean_i, "isc": isc, "deviation": deviation},
        )
    return ComplianceResult(
        standard=standard, passed=True,
        reason=f"{cycles_completed} cycles completed; hot-phase I = {mean_i:.3f} A",
        metrics={"cycles_completed": cycles_completed, "mean_hot_current": mean_i,
                 "deviation": deviation},
    )


def validate_humidity_freeze(
    samples: Sequence[Sample],
    *,
    cycles_completed: int,
    cycles_target: int = 10,
    isc: float = 0.0,
) -> ComplianceResult:
    """IEC 61215-2 MQT 12: 10 cycles of 85 C/85 %RH then -40 C."""
    standard = "IEC 61215-2 MQT 12"
    if cycles_completed < cycles_target:
        return ComplianceResult(
            standard=standard, passed=False,
            reason=f"Clause 12.5: only {cycles_completed}/{cycles_target} cycles completed",
            metrics={"cycles_completed": cycles_completed},
        )
    hot = [s for s in samples if s.step.startswith("hot")]
    if isc > 0 and hot:
        mean_i = statistics.fmean(_currents(hot))
        if abs(mean_i - isc) / isc > 0.10:
            return ComplianceResult(
                standard=standard, passed=False,
                reason=f"hot-phase current {mean_i:.3f} A outside +-10 % of Isc",
                metrics={"mean_hot_current": mean_i, "isc": isc},
            )
    return ComplianceResult(standard=standard, passed=True,
                            reason=f"{cycles_completed} cycles completed",
                            metrics={"cycles_completed": cycles_completed})


def validate_letid(
    samples: Sequence[Sample],
    *,
    duration_h_target: float,
    elapsed_h: float,
    idark_target: float,
    drift_tolerance: float = 0.005,
) -> ComplianceResult:
    """IEC TS 63342: 75 C +-3 C, Idark = Isc - Imp, 162 h.

    Clause 6.3 requires the dark current to remain stable; we flag
    drift >0.5 % from the setpoint as non-compliant injection.
    """
    standard = "IEC TS 63342"
    if elapsed_h + 1e-6 < duration_h_target:
        return ComplianceResult(
            standard=standard, passed=False,
            reason=(f"Clause 6.2: ran {elapsed_h:.2f} h of "
                    f"{duration_h_target} h required"),
            metrics={"elapsed_h": elapsed_h, "duration_h_target": duration_h_target},
        )
    currents = _currents(samples)
    if not currents:
        return ComplianceResult(standard=standard, passed=False,
                                reason="no current samples recorded",
                                metrics={})
    mean_i = statistics.fmean(currents)
    max_drift = max(abs(c - idark_target) for c in currents) / max(idark_target, 1e-9)
    if max_drift > drift_tolerance:
        return ComplianceResult(
            standard=standard, passed=False,
            reason=(f"Idark drift {max_drift*100:.2f}% exceeds 0.5 % "
                    f"(target {idark_target:.4f} A)"),
            metrics={"mean_current": mean_i, "max_drift": max_drift,
                     "idark_target": idark_target},
        )
    return ComplianceResult(
        standard=standard, passed=True,
        reason=(f"{elapsed_h:.1f} h at Idark={mean_i:.4f} A "
                f"(target {idark_target:.4f} A)"),
        metrics={"mean_current": mean_i, "max_drift": max_drift,
                 "elapsed_h": elapsed_h},
    )


def validate_bypass_diode(
    samples: Sequence[Sample],
    *,
    elapsed_s: float,
    duration_s_target: float,
    vf_limit_per_diode: float,
    num_diodes: int,
) -> ComplianceResult:
    """IEC 62979: 1.35 x Isc for 1 h, no thermal runaway.

    Clause 8: pass if the diode string remains below the forward-voltage
    runaway threshold (default 0.7 V per diode) for the full duration.
    """
    standard = "IEC 62979"
    vf_limit = vf_limit_per_diode * num_diodes
    if elapsed_s + 1.0 < duration_s_target:
        return ComplianceResult(
            standard=standard, passed=False,
            reason=(f"Clause 8: ran {elapsed_s:.0f} s of "
                    f"{duration_s_target:.0f} s required"),
            metrics={"elapsed_s": elapsed_s, "duration_s_target": duration_s_target},
        )
    voltages = _voltages(samples)
    if not voltages:
        return ComplianceResult(standard=standard, passed=False,
                                reason="no samples recorded", metrics={})
    vmax = max(voltages)
    if vmax > vf_limit:
        return ComplianceResult(
            standard=standard, passed=False,
            reason=(f"Vf peak {vmax:.3f} V exceeds runaway limit "
                    f"{vf_limit:.3f} V ({num_diodes} x {vf_limit_per_diode} V)"),
            metrics={"vf_peak": vmax, "vf_limit": vf_limit},
        )
    return ComplianceResult(
        standard=standard, passed=True,
        reason=f"completed 1 h at 1.35 x Isc; Vf peak {vmax:.3f} V < {vf_limit:.3f} V",
        metrics={"vf_peak": vmax, "vf_limit": vf_limit, "elapsed_s": elapsed_s},
    )


def validate_reverse_current_overload(
    samples: Sequence[Sample],
    *,
    elapsed_s: float,
    duration_s_target: float,
    test_current_a: float,
    fuse_blew: bool,
) -> ComplianceResult:
    """IEC 61730-2 MST 26: 135 % of fuse rating for 2 h.

    Pass criterion (Clause 10.13): module survives the overload without
    fire or shock hazard. We model the survival case as completing the
    full duration without the protective fuse opening.
    """
    standard = "IEC 61730-2 MST 26"
    if fuse_blew:
        return ComplianceResult(
            standard=standard, passed=False,
            reason=f"protective fuse opened at t={elapsed_s:.1f} s (test_current {test_current_a:.2f} A)",
            metrics={"fuse_blew_at": elapsed_s, "test_current_a": test_current_a},
        )
    if elapsed_s + 1.0 < duration_s_target:
        return ComplianceResult(
            standard=standard, passed=False,
            reason=f"ran {elapsed_s:.0f} s of {duration_s_target:.0f} s",
            metrics={"elapsed_s": elapsed_s},
        )
    currents = [abs(c) for c in _currents(samples) if abs(c) > 0.1]
    mean_i = statistics.fmean(currents) if currents else 0.0
    return ComplianceResult(
        standard=standard, passed=True,
        reason=(f"sustained {mean_i:.2f} A for {elapsed_s:.0f} s "
                f"(target {test_current_a:.2f} A)"),
        metrics={"mean_current": mean_i, "elapsed_s": elapsed_s},
    )


def validate_ground_continuity(
    *,
    resistance_ohm: float,
    test_current_a: float,
    rated_current_a: float,
    limit_ohm: float = 0.1,
    required_current_multiplier: float = 2.5,
) -> ComplianceResult:
    """IEC 61730-2 MST 13: 2.5 x rated current, R < 0.1 ohm.

    Clause 10.5.1 requires the test current to be at least 2.5 x rated
    current, and the measured frame-to-earth resistance to be < 0.1 ohm.
    """
    standard = "IEC 61730-2 MST 13"
    required_i = rated_current_a * required_current_multiplier
    if test_current_a + 1e-6 < required_i:
        return ComplianceResult(
            standard=standard, passed=False,
            reason=(f"test current {test_current_a:.2f} A below required "
                    f"{required_i:.2f} A (2.5 x {rated_current_a:.2f})"),
            metrics={"test_current_a": test_current_a, "required_a": required_i},
        )
    if math.isnan(resistance_ohm) or resistance_ohm >= limit_ohm:
        return ComplianceResult(
            standard=standard, passed=False,
            reason=f"R = {resistance_ohm:.4f} ohm >= {limit_ohm} ohm",
            metrics={"resistance_ohm": resistance_ohm, "limit_ohm": limit_ohm},
        )
    return ComplianceResult(
        standard=standard, passed=True,
        reason=f"R = {resistance_ohm:.4f} ohm < {limit_ohm} ohm at {test_current_a:.1f} A",
        metrics={"resistance_ohm": resistance_ohm, "limit_ohm": limit_ohm,
                 "test_current_a": test_current_a},
    )
