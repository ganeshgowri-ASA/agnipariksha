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
