"""Ground Continuity Test — IEC 61730-2 MST 13

Test Parameters:
- Test current: 25A AC (or DC equivalent)
- Voltage drop limit: < 2.5 V (implies R < 0.1 Ω)
- Pass criterion: Resistance < 0.1 Ω between frame and earth
- Duration: Until stable reading (< 30 seconds)

Power Supply Role (DC method):
- Source 25A DC through frame-to-earth path
- Measure voltage drop
- Calculate R = V/I
- Pass if R < 0.1 Ω
"""
import asyncio
import uuid
import time
from scpi_driver import SCPIDriver

class GroundContinuityTest:
    STANDARD = "IEC 61730-2 MST 13"
    TEST_CURRENT_A = 25.0
    PASS_RESISTANCE_OHM = 0.1
    TEST_VOLTAGE_LIMIT_V = 2.5
    STABILIZE_TIME_S = 5
    
    def __init__(self, scpi: SCPIDriver):
        self.scpi = scpi
        self.session_id = str(uuid.uuid4())

    async def run(self) -> dict:
        """Run complete ground continuity test, return PASS/FAIL result."""
        print(f"[GCT] Session {self.session_id} — Injecting {self.TEST_CURRENT_A}A")
        
        # Configure CC mode: 25A, voltage limit 2.5V
        await self.scpi.send("SOUR:FUNC CURR")  # CC priority
        await self.scpi.set_current(self.TEST_CURRENT_A)
        await self.scpi.set_ovp(self.TEST_VOLTAGE_LIMIT_V * 1.1)
        await self.scpi.set_output(True)
        
        # Wait for stabilization
        await asyncio.sleep(self.STABILIZE_TIME_S)
        
        # Measure
        v = await self.scpi.measure_voltage()
        i = await self.scpi.measure_current()
        
        # Calculate resistance
        r = v / i if i > 0.1 else 999.0
        passed = r < self.PASS_RESISTANCE_OHM
        
        await self.scpi.set_output(False)
        
        result = {
            "session_id": self.session_id,
            "test": "ground_continuity",
            "standard": self.STANDARD,
            "voltage_v": round(v, 4),
            "current_a": round(i, 4),
            "resistance_ohm": round(r, 6),
            "pass_limit_ohm": self.PASS_RESISTANCE_OHM,
            "result": "PASS" if passed else "FAIL",
            "timestamp": time.time(),
        }
        print(f"[GCT] R = {r:.6f} Ω → {'PASS ✓' if passed else 'FAIL ✗'}")
        return result
