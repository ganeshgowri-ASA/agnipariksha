"""Bypass Diode Thermal Test — IEC 62979:2017

Test Parameters:
- Current: 1.35 × Isc (135% of short-circuit current)
- Duration: 1 hour continuous
- Pass criterion: No thermal runaway (junction < 128°C)
  Measured via forward voltage drop: Vf < 0.7V indicates safe
- Temperature monitoring: IR camera or Vf measurement

Power Supply Role:
- Source constant current at 1.35 × Isc
- Voltage compliance: enough for forward bias (< 2V per diode)
- Monitor current stability throughout 1h duration
"""
import asyncio
import uuid
import time
from scpi_driver import SCPIDriver

class BypassDiodeTest:
    STANDARD = "IEC 62979:2017"
    CURRENT_MULTIPLIER = 1.35
    DURATION_SECONDS = 3600  # 1 hour
    VF_PASS_LIMIT = 0.7  # Forward voltage threshold
    MONITOR_INTERVAL_S = 60
    
    def __init__(self, scpi: SCPIDriver):
        self.scpi = scpi
        self.session_id = str(uuid.uuid4())
        self.running = False

    async def start(
        self,
        isc: float = 9.5,       # Module Isc (A)
        num_bypass_diodes: int = 3,
    ) -> str:
        self.running = True
        i_test = round(isc * self.CURRENT_MULTIPLIER, 3)
        v_compliance = num_bypass_diodes * 1.5  # 1.5V per diode headroom
        
        print(f"[BDT] I_test = {isc:.2f} × 1.35 = {i_test:.3f} A for 1 hour")
        
        await self.scpi.send("SOUR:FUNC CURR")  # CC priority
        await self.scpi.set_current(i_test)
        await self.scpi.set_ovp(v_compliance * 1.1)
        await self.scpi.set_output(True)
        
        asyncio.create_task(self._monitor(i_test))
        return self.session_id

    async def _monitor(self, i_test: float):
        start_time = time.time()
        while self.running and (time.time() - start_time) < self.DURATION_SECONDS:
            m = await self.scpi.measure_all()
            elapsed_min = (time.time() - start_time) / 60
            vf = m['voltage']  # Forward voltage across bypass string
            print(f"[BDT] t={elapsed_min:.1f}min Vf={vf:.3f}V I={m['current']:.3f}A")
            if vf > self.VF_PASS_LIMIT * 3:  # All 3 diodes limit
                print("[BDT] WARNING: High Vf — possible thermal runaway")
            await asyncio.sleep(self.MONITOR_INTERVAL_S)
        await self.scpi.set_output(False)
        self.running = False

    async def stop(self):
        self.running = False
        await self.scpi.emergency_stop()
