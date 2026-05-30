"""Thermal Cycling Test — IEC 61215-2 MQT 11

Test Parameters:
- Temperature range: -40°C to +85°C (standard)
- Ramp rate: ~100°C/hour max
- Dwell time: 10 min at each extreme
- Cycles: 200 (qualification) or 50 (prequalification)
- Current injection: Isc during heating phase

Power Supply Role:
- Source Isc current at module Voc during heating
- Remove current at cooling phase
- Monitor for bypass diode activation
"""
import asyncio
import uuid
import time
from dataclasses import dataclass
from typing import Sequence
from scpi_driver import SCPIDriver

# IEC 61215-2 MQT 11 constants — mirrored on the frontend in
# frontend/features/tc/analysis/tcAnalysis.ts (TC_CONSTANTS) so the Isc
# gate, ramp clamp, and dwell minima cannot drift between client and
# server. Update both files together when the standard revisions land.
MQT11_MAX_RAMP_C_PER_H = 100.0
MQT11_WARN_RAMP_C_PER_H = 120.0  # warning band ceiling (100–120 °C/h)
MQT11_ISC_GATE_C = 25.0   # MQT 11.6.3 a — Isc only when T_module > 25 °C
MQT11_MIN_DWELL_S = 10 * 60


# ---------------------------------------------------------------------------
# TC extensions — bifacial position tolerance sets, point-to-point /
# cumulative ramp, and junction-box mass-loading validation. Mirrors
# frontend/features/tc/analysis/tcExtensions.ts so client (display) and
# server (control) never diverge on a verdict. Update both together.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PositionTolerance:
    """Per-position tolerance set driving the ramp verdict.

    IEC 61215-2 MQT 11.6.1 (temperature tolerance) / 11.6.2 (ramp ceiling).
    """

    max_ramp_c_per_h: float  # MQT 11.6.2 — ramp ceiling (fail above)
    warn_ramp_c_per_h: float  # warning-band ceiling
    temp_tolerance_c: float  # MQT 11.6.1 — allowed band around each plateau
    clause: str  # human-readable clause reference
    label: str  # short operator-facing label


# Per-position tolerance sets — see the frontend module for the per-position
# rationale. BIFACIAL is the symmetric baseline; BSI (single-side
# illuminated) tightens the ramp; BNBI (rear blocked / mono-facial) relaxes
# the plateau band.
POSITION_TOLERANCES: dict[str, PositionTolerance] = {
    # MQT 11.6.2 / 11.6.1 — symmetric bifacial baseline.
    "BIFACIAL": PositionTolerance(
        max_ramp_c_per_h=MQT11_MAX_RAMP_C_PER_H,  # 100 °C/h
        warn_ramp_c_per_h=MQT11_WARN_RAMP_C_PER_H,  # 120 °C/h
        temp_tolerance_c=2.0,
        clause="MQT 11.6.2 (bifacial)",
        label="Bifacial (both sides active)",
    ),
    # MQT 11.6.2 — single-side illuminated, tighter ramp.
    "BSI": PositionTolerance(
        max_ramp_c_per_h=90.0,
        warn_ramp_c_per_h=110.0,
        temp_tolerance_c=2.0,
        clause="MQT 11.6.2 (BSI)",
        label="Bifacial single-side illuminated",
    ),
    # MQT 11.6.1 — rear blocked, relaxed plateau band.
    "BNBI": PositionTolerance(
        max_ramp_c_per_h=MQT11_MAX_RAMP_C_PER_H,  # 100 °C/h
        warn_ramp_c_per_h=MQT11_WARN_RAMP_C_PER_H,  # 120 °C/h
        temp_tolerance_c=3.0,
        clause="MQT 11.6.1 (BNBI)",
        label="Bifacial as non-bifacial (rear blocked)",
    ),
}


def position_tolerance_set(position: str) -> PositionTolerance:
    """Resolve a position to its tolerance set.

    Defensive: an unknown/legacy value falls back to the symmetric
    BIFACIAL baseline so the verdict path always has a concrete ceiling.
    """
    return POSITION_TOLERANCES.get(position, POSITION_TOLERANCES["BIFACIAL"])


def validate_mass_loading(mass_kg: float) -> float:
    """Validate the junction-box / mounting mass loading (kg).

    Encodes the MQT 11 mounting / mass-loading requirement: the declared
    mass must be a real, strictly-positive figure. A zero or negative
    entry is a data-entry error (use a tiny positive value for negligible
    mass), so we RAISE rather than silently accept it. Mirrors the
    frontend ``validateMassLoadingKg`` which throws on the same condition.

    Args:
        mass_kg: operator-declared mounting mass in kilograms.

    Returns:
        The mass unchanged when valid.

    Raises:
        ValueError: when ``mass_kg`` <= 0 or is not finite.
    """
    if not (mass_kg == mass_kg) or mass_kg in (float("inf"), float("-inf")):
        raise ValueError("junction-box mass loading must be a finite number")
    if mass_kg <= 0:
        raise ValueError("junction-box mass loading must be > 0 kg")
    return mass_kg


def point_to_point_ramp(samples: Sequence[tuple[float, float]]) -> float:
    """Point-to-point (instantaneous) ramp rate, °C/h.

    ``samples`` is a sequence of ``(timestamp_ms, temperature_c)`` pairs.
    Returns the worst (largest absolute) ramp between any two CONSECUTIVE
    samples — the MQT 11.6.2 ceiling applies to the instantaneous rate, not
    just the average. Pairs with a non-advancing timestamp are skipped;
    fewer than two usable samples yields 0.0.
    """
    worst = 0.0
    for (t0, c0), (t1, c1) in zip(samples, samples[1:]):
        dt_h = (t1 - t0) / 3_600_000.0
        if dt_h <= 0:
            continue
        ramp = abs((c1 - c0) / dt_h)
        if ramp > worst:
            worst = ramp
    return worst


def cumulative_ramp(samples: Sequence[tuple[float, float]]) -> float:
    """Cumulative (run-averaged) ramp rate, °C/h.

    Total absolute temperature travelled divided by total elapsed time over
    the whole run. Complements ``point_to_point_ramp``: a compliant average
    can hide a non-compliant instantaneous spike, so both are reported.
    Fewer than two usable samples (or zero elapsed time) yields 0.0.
    """
    total_delta_c = 0.0
    total_dt_h = 0.0
    for (t0, c0), (t1, c1) in zip(samples, samples[1:]):
        dt_h = (t1 - t0) / 3_600_000.0
        if dt_h <= 0:
            continue
        total_delta_c += abs(c1 - c0)
        total_dt_h += dt_h
    return total_delta_c / total_dt_h if total_dt_h > 0 else 0.0


def classify_ramp_for_position(abs_cph: float, tol: PositionTolerance) -> str:
    """Classify an absolute ramp against a position tolerance set.

    Returns one of ``"pass"`` / ``"warn"`` / ``"fail"`` — matching the
    frontend ``RampVerdict`` labels (minus ``pending``, which is a UI-only
    state for empty telemetry).
    """
    if abs_cph <= tol.max_ramp_c_per_h:
        return "pass"
    if abs_cph <= tol.warn_ramp_c_per_h:
        return "warn"
    return "fail"


def isc_gate_setpoint(t_module_c: float | None, isc: float) -> float:
    """Return the safe SOUR:CURR setpoint for the heating phase.

    Encodes MQT 11.6.3 a: short-circuit current is applied only when
    the module temperature exceeds 25 °C. Below the threshold (or with
    no thermocouple reading) the orchestrator MUST send ``SOUR:CURR 0``
    regardless of the operator-configured ``isc``. The same rule is
    implemented on the frontend so the operator dashboard and the bench
    show the same Isc-gate state at all times.

    Args:
        t_module_c: latest module temperature in °C, or ``None`` if no
            thermocouple reading is available yet.
        isc: operator-configured Isc setpoint (A). Returned only when the
            gate is open.

    Returns:
        The safe current setpoint to actually load into the PSU.
    """
    if t_module_c is None or t_module_c <= MQT11_ISC_GATE_C:
        return 0.0
    return isc


def clamp_ramp_rate(rate_c_per_h: float) -> float:
    """Clamp the operator's ramp setpoint to the MQT 11.6.2 ceiling.

    The frontend already constrains the input field to <=100, but a
    misbehaving caller (CLI script, replay, etc.) could still pass a
    value above the ceiling. We clamp defensively so the PSU never sees
    a non-compliant ramp request even with a bad input.
    """
    if rate_c_per_h <= 0:
        raise ValueError("ramp rate must be > 0 °C/h")
    return min(rate_c_per_h, MQT11_MAX_RAMP_C_PER_H)


class ThermalCyclingTest:
    # IEC 61215-2 MQT 11 parameters
    STANDARD = "IEC 61215-2 MQT 11"
    DEFAULT_CYCLES = 200
    DWELL_SECONDS = 600  # 10 min
    
    def __init__(self, scpi: SCPIDriver):
        self.scpi = scpi
        self.session_id = str(uuid.uuid4())
        self.running = False
        
    async def start(
        self,
        voc: float = 45.0,       # Module Voc (V)
        isc: float = 9.5,        # Module Isc (A)
        cycles: int = DEFAULT_CYCLES,
        hot_dwell_s: int = DWELL_SECONDS,
        cold_dwell_s: int = DWELL_SECONDS,
    ) -> str:
        """Start thermal cycling with current injection at Voc."""
        self.running = True
        print(f"[TC] Session {self.session_id} started — {cycles} cycles")
        
        # Set protection limits
        await self.scpi.set_ovp(voc * 1.1)  # 110% Voc
        await self.scpi.set_ocp(isc * 1.15)  # 115% Isc
        
        # Program: inject Isc at Voc for heating phases, 0A for cooling
        # Each cycle = hot phase (current on) + cold phase (current off)
        voltages = [voc, 0.1] * cycles
        currents = [isc, 0.0] * cycles
        durations = [hot_dwell_s, cold_dwell_s] * cycles
        
        await self.scpi.load_program(voltages, currents, durations, repeat=1)
        await self.scpi.set_output(True)
        await self.scpi.run_program()
        
        return self.session_id

    async def stop(self):
        self.running = False
        await self.scpi.emergency_stop()
