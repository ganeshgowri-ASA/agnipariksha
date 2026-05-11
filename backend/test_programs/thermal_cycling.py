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
