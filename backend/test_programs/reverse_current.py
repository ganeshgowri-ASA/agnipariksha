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

class ReverseCurrentTest:
    STANDARD = "IEC 61730-2 MST 26"
    FUSE_MULTIPLIER = 1.35
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
