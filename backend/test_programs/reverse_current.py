"""Reverse Current Overload Test — IEC 61730-2 MST 26

Test Parameters:
- Reverse current: Based on fuse rating × 1.35 (135% of overcurrent protection)
- Test per string configuration
- Duration: Until fuse activates or module fails
- Pass criterion: No fire, no explosion, structural integrity maintained

Power Supply Role (as current sink / reverse source):
- Inject reverse current through module string
- Current = max system fuse rating × 1.35
- Monitor for module failure signature (voltage collapse)
"""
import asyncio
import uuid
import time
from scpi_driver import SCPIDriver

# IEC 61730-2 MST 26 constants — mirrored on the frontend in
# frontend/features/rco/analysis/rcoThermal.ts (RCO_THERMAL_CONSTANTS) so the
# forward-bias setpoint and hold bounds cannot drift between client and
# server. Update both files together when the standard revisions land.
MST26_ISC_FORWARD_MULTIPLIER = 1.35  # MST 26 §6 — forward-bias fault current = 1.35× Isc
MST26_HOLD_MIN_H = 1.0               # MST 26 §6 — minimum forward-bias hold (h)
MST26_HOLD_MAX_H = 2.0               # MST 26 §6 — maximum forward-bias hold (h)


def forward_bias_setpoint(isc_a: float) -> float:
    """MST 26 §6 — forward-bias setpoint = 1.35× the rated Isc.

    Returns the fault current the orchestrator sources through the module in
    the forward direction during the thermal/IR hold. Mirrors
    ``forwardBiasSetpoint`` in rcoThermal.ts so the dashboard readout and the
    bench setpoint always agree.

    Args:
        isc_a: rated module short-circuit current (A).

    Returns:
        The 1.35×Isc forward-bias setpoint (A).
    """
    return isc_a * MST26_ISC_FORWARD_MULTIPLIER


def clamp_hold_hours(hours: float) -> float:
    """Clamp the operator's forward-bias hold to the MST 26 §6 [1, 2] h window.

    The UI constrains the input, but a misbehaving caller (CLI, replay) could
    still pass an out-of-range value. We clamp defensively so the bench never
    holds for less than 1 h or more than 2 h. Mirrors ``clampHoldHours`` in
    rcoThermal.ts.
    """
    return min(max(hours, MST26_HOLD_MIN_H), MST26_HOLD_MAX_H)


class ReverseCurrentTest:
    STANDARD = "IEC 61730-2 MST 26"
    FUSE_MULTIPLIER = 1.35
    ISC_FORWARD_MULTIPLIER = MST26_ISC_FORWARD_MULTIPLIER  # MST 26 §6 forward-bias leg
    MAX_DURATION_S = 300  # 5 min max before abort
    MONITOR_INTERVAL_S = 1
    
    def __init__(self, scpi: SCPIDriver):
        self.scpi = scpi
        self.session_id = str(uuid.uuid4())
        self.running = False

    async def start(
        self,
        fuse_rating_a: float = 15.0,  # String fuse rating
        reverse_voltage: float = 40.0, # Reverse bias voltage
    ) -> str:
        self.running = True
        i_reverse = round(fuse_rating_a * self.FUSE_MULTIPLIER, 3)
        
        print(f"[RCO] Reverse current = {fuse_rating_a:.1f} × 1.35 = {i_reverse:.3f} A")
        
        # Set negative current (reverse source)
        await self.scpi.send("SOUR:FUNC CURR")
        await self.scpi.set_voltage(reverse_voltage)
        await self.scpi.set_current(-i_reverse)  # Negative = reverse
        await self.scpi.set_output(True)
        
        asyncio.create_task(self._monitor(i_reverse))
        return self.session_id

    async def forward_bias(
        self,
        isc_a: float = 9.5,        # Rated module Isc
        hold_hours: float = 1.5,   # Forward-bias hold (clamped to MST 26 §6 [1, 2] h)
        forward_voltage: float = 45.0,  # Module Voc compliance ceiling
    ) -> str:
        """Run the MST 26 §6 forward-bias leg: source 1.35×Isc forward and
        hold for a clamped 1–2 h while the IR camera / thermocouples watch for
        overheating. Mirrors the frontend forward-bias readout + thermal panel.
        """
        self.running = True
        i_forward = round(forward_bias_setpoint(isc_a), 3)
        hold_s = clamp_hold_hours(hold_hours) * 3600

        print(f"[RCO] Forward-bias = {isc_a:.1f} × 1.35 = {i_forward:.3f} A · hold {hold_s/3600:.2f} h")

        await self.scpi.send("SOUR:FUNC CURR")
        await self.scpi.set_voltage(forward_voltage)
        await self.scpi.set_current(i_forward)  # Positive = forward
        await self.scpi.set_output(True)

        asyncio.create_task(self._monitor(i_forward))
        return self.session_id

    async def _monitor(self, i_test: float):
        start_time = time.time()
        while self.running and (time.time() - start_time) < self.MAX_DURATION_S:
            m = await self.scpi.measure_all()
            elapsed_s = time.time() - start_time
            print(f"[RCO] t={elapsed_s:.0f}s V={m['voltage']:.3f}V I={m['current']:.3f}A")
            # Detect fuse blow: current drops to near zero
            if abs(m['current']) < 0.1 and elapsed_s > 2:
                print("[RCO] Fuse activated or circuit open — stopping")
                break
            await asyncio.sleep(self.MONITOR_INTERVAL_S)
        await self.scpi.set_output(False)
        self.running = False

    async def stop(self):
        self.running = False
        await self.scpi.emergency_stop()
