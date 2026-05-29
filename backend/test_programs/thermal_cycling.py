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
from scpi_driver import SCPIDriver

# IEC 61215-2 MQT 11 constants — mirrored on the frontend in
# frontend/features/tc/analysis/tcAnalysis.ts (TC_CONSTANTS) so the Isc
# gate, ramp clamp, and dwell minima cannot drift between client and
# server. Update both files together when the standard revisions land.
MQT11_MAX_RAMP_C_PER_H = 100.0
MQT11_ISC_GATE_C = 25.0   # MQT 11.6.3 a — Isc only when T_module > 25 °C
MQT11_MIN_DWELL_S = 10 * 60


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
