"""LeTID Test — IEC TS 63342:2022

Light and elevated Temperature Induced Degradation

Test Parameters (IEC TS 63342:2022):
- Temperature: 75°C ± 3°C
- Irradiance: 1 sun equivalent OR dark injection
- Dark current injection: Idark = Isc - Imp (bypass current)
- Duration: 162 hours minimum
- Measurement intervals: Every 2 hours (power output)
- Pass/Fail: Pmax degradation < 2% from STC

Power Supply Role:
- Inject dark current: Idark = Isc - Imp at module Vmpp
- Maintain constant current for full 162 h duration
- Monitor for current drift > 0.5%
"""
import asyncio
import uuid
import time
from scpi_driver import SCPIDriver

class LeTIDTest:
    STANDARD = "IEC TS 63342:2022"
    DURATION_HOURS = 162
    TEMP_TARGET = 75.0
    TEMP_TOLERANCE = 3.0
    MEASUREMENT_INTERVAL_S = 7200  # 2 hours
    
    def __init__(self, scpi: SCPIDriver):
        self.scpi = scpi
        self.session_id = str(uuid.uuid4())
        self.running = False

    def calculate_idark(self, isc: float, imp: float) -> float:
        """Dark current = Isc - Imp per IEC TS 63342:2022"""
        return round(isc - imp, 4)

    async def start(
        self,
        vmpp: float = 37.5,    # V_mpp at STC (V)
        isc: float = 9.5,      # I_sc at STC (A)  
        imp: float = 8.9,      # I_mp at STC (A)
        voc: float = 45.0,     # V_oc at STC (V)
        duration_h: int = DURATION_HOURS,
    ) -> str:
        self.running = True
        idark = self.calculate_idark(isc, imp)
        duration_s = duration_h * 3600
        
        print(f"[LeTID] Session {self.session_id}")
        print(f"  Idark = {isc:.2f} - {imp:.2f} = {idark:.4f} A")
        print(f"  Vmpp = {vmpp:.2f} V | Duration = {duration_h} h")
        
        # Set CV mode at Vmpp, inject Idark
        await self.scpi.set_ovp(voc * 1.05)
        await self.scpi.set_ocp(isc * 1.1)
        await self.scpi.set_voltage(vmpp)
        await self.scpi.set_current(idark)
        await self.scpi.set_output(True)
        
        # Run for full duration with periodic measurement
        asyncio.create_task(self._monitor_loop(duration_s))
        return self.session_id

    async def _monitor_loop(self, duration_s: int):
        start_time = time.time()
        while self.running and (time.time() - start_time) < duration_s:
            measurements = await self.scpi.measure_all()
            elapsed_h = (time.time() - start_time) / 3600
            print(f"[LeTID] t={elapsed_h:.1f}h V={measurements['voltage']:.3f}V I={measurements['current']:.4f}A")
            # TODO: Store to TimescaleDB
            await asyncio.sleep(self.MEASUREMENT_INTERVAL_S)
        await self.scpi.set_output(False)
        self.running = False
        print(f"[LeTID] Test complete. Session: {self.session_id}")

    async def stop(self):
        self.running = False
        await self.scpi.emergency_stop()
