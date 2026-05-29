"""Humidity Freeze Test — IEC 61215-2 MQT 12

Test Parameters:
- Temperature: +85°C / 85% RH (hot phase) → -40°C (freeze phase)
- Transition time: < 30 minutes
- Dwell at each extreme: 20 hours minimum
- Cycles: 10
- Current during hot phase: Isc at Voc (same as TC test)

Power Supply Role:
- Inject Isc at Voc during the 85°C/85%RH phase
- Remove current during freeze phase (-40°C)
- Cycle 10 times synchronized with thermal chamber
"""
import asyncio
import uuid
import time
from scpi_driver import SCPIDriver

# IEC 61215-2 MQT 12 constants — mirrored on the frontend in
# frontend/features/hf/analysis/hfAnalysis.ts (HF_CONSTANTS). The Isc
# gate is the same MQT 11.6.3 a rule used by the TC test, so we
# re-export the TC helper here for orchestrator use.
MQT12_HOT_DWELL_MIN_S = 20 * 3600   # 20 h hot/humid soak
MQT12_COLD_DWELL_MIN_S = 30 * 60    # 30 min cold freeze
MQT12_TRANSITION_MAX_S = 30 * 60    # 30 min between extremes
MQT12_RH_TARGET_PCT = 85.0
MQT12_RH_TOL_PCT = 5.0
MQT12_T_HOT_TOL_C = 2.0
MQT12_T_COLD_TOL_C = 2.0

# Re-export from thermal_cycling for orchestrator convenience.
from test_programs.thermal_cycling import (  # noqa: E402,F401
    isc_gate_setpoint as mqt12_isc_gate_setpoint,
    MQT11_ISC_GATE_C as MQT12_ISC_GATE_C,
)


def validate_hf_setup(
    cycles: int,
    hot_dwell_s: int,
    cold_dwell_s: int,
    rh_setpoint_pct: float,
) -> list[str]:
    """Pre-flight validation against MQT 12.6.2 — returns a list of
    operator-readable warnings. Empty list means the setup conforms.

    Used by the orchestrator before any SCPI write, and by the future
    Basic Check sub-tab on the HF Tab to flag misconfigured runs.
    """
    issues: list[str] = []
    if cycles < 10:
        issues.append(
            f"MQT 12 specifies 10 cycles minimum (you set {cycles}). "
            "Lower-cycle runs are valid for pre-qualification but not for type approval."
        )
    if hot_dwell_s < MQT12_HOT_DWELL_MIN_S:
        issues.append(
            f"Hot/humid dwell {hot_dwell_s/3600:.1f}h is below MQT 12.6.2 a minimum of "
            f"{MQT12_HOT_DWELL_MIN_S/3600:.0f}h."
        )
    if cold_dwell_s < MQT12_COLD_DWELL_MIN_S:
        issues.append(
            f"Cold freeze dwell {cold_dwell_s/60:.1f}min is below MQT 12.6.2 b minimum of "
            f"{MQT12_COLD_DWELL_MIN_S/60:.0f}min."
        )
    if abs(rh_setpoint_pct - MQT12_RH_TARGET_PCT) > MQT12_RH_TOL_PCT:
        issues.append(
            f"RH setpoint {rh_setpoint_pct:.0f}% is outside the MQT 12.6.2 a band of "
            f"{MQT12_RH_TARGET_PCT}±{MQT12_RH_TOL_PCT}%."
        )
    return issues


class HumidityFreezeTest:
    STANDARD = "IEC 61215-2 MQT 12"
    DEFAULT_CYCLES = 10
    HOT_DWELL_HOURS = 20
    COLD_DWELL_HOURS = 20
    
    def __init__(self, scpi: SCPIDriver):
        self.scpi = scpi
        self.session_id = str(uuid.uuid4())
        self.running = False

    async def start(
        self,
        voc: float = 45.0,
        isc: float = 9.5,
        cycles: int = DEFAULT_CYCLES,
    ) -> str:
        self.running = True
        hot_s = self.HOT_DWELL_HOURS * 3600
        cold_s = self.COLD_DWELL_HOURS * 3600
        
        print(f"[HF] Session {self.session_id} — {cycles} cycles, {self.HOT_DWELL_HOURS+self.COLD_DWELL_HOURS}h per cycle")
        
        # Program: current injection during hot phase only
        await self.scpi.set_ovp(voc * 1.1)
        await self.scpi.set_ocp(isc * 1.15)
        
        voltages = [voc, 0.1] * cycles
        currents = [isc, 0.0] * cycles
        durations = [hot_s, cold_s] * cycles
        
        await self.scpi.load_program(voltages, currents, durations, repeat=1)
        await self.scpi.set_output(True)
        await self.scpi.run_program()
        
        return self.session_id

    async def stop(self):
        self.running = False
        await self.scpi.emergency_stop()
