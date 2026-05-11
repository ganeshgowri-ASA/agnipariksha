"""SCPI TCP Driver for ITECH IT6000C

Connects via raw TCP socket to IT6000C at IP:Port
All SCPI commands per IT6000C programming manual.
"""
import asyncio
import time
import random
from typing import Optional

class SCPIDriver:
    def __init__(self, host: str = "192.168.200.100", port: int = 30000, demo_mode: bool = False):
        self.host = host
        self.port = port
        self.demo_mode = demo_mode
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self.is_connected = False
        self._lock = asyncio.Lock()
        self._demo_t = 0.0

    async def connect(self) -> bool:
        if self.demo_mode:
            self.is_connected = True
            return True
        try:
            self._reader, self._writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, self.port), timeout=5.0
            )
            self.is_connected = True
            return True
        except Exception as e:
            print(f"SCPI connect failed: {e}")
            self.is_connected = False
            return False

    async def disconnect(self):
        if self._writer:
            try:
                await self.send("OUTP OFF")
            except:
                pass
            self._writer.close()
            await self._writer.wait_closed()
        self.is_connected = False

    async def send(self, cmd: str) -> Optional[str]:
        if self.demo_mode:
            return self._demo_response(cmd)
        async with self._lock:
            try:
                self._writer.write((cmd + "\n").encode())
                await self._writer.drain()
                if "?" in cmd:
                    response = await asyncio.wait_for(
                        self._reader.readline(), timeout=3.0
                    )
                    return response.decode().strip()
                return None
            except Exception as e:
                print(f"SCPI error [{cmd}]: {e}")
                self.is_connected = False
                return None

    def _demo_response(self, cmd: str) -> str:
        self._demo_t += 0.5
        if "IDN" in cmd:
            return "ITECH,IT6018C-500-30,SN123456,V1.09"
        if "MEAS:VOLT" in cmd:
            return f"{35.0 + 2*random.sin(self._demo_t/10):.3f}"
        if "MEAS:CURR" in cmd:
            return f"{8.5 + random.gauss(0, 0.05):.4f}"
        if "MEAS:POW" in cmd:
            return f"{298.0 + random.gauss(0, 2):.2f}"
        return "OK"

    async def idn(self) -> str:
        return await self.send("*IDN?") or "UNKNOWN"

    async def set_voltage(self, v: float):
        await self.send(f"SOUR:VOLT {v:.3f}")

    async def set_current(self, i: float):
        await self.send(f"SOUR:CURR {i:.4f}")

    async def set_output(self, on: bool):
        await self.send(f"OUTP {'ON' if on else 'OFF'}")

    async def set_ovp(self, level: float, delay: float = 0.01):
        await self.send(f"SOUR:VOLT:PROT:LEV {level:.3f}")
        await self.send(f"SOUR:VOLT:PROT:DEL {delay:.3f}")
        await self.send("SOUR:VOLT:PROT:STAT ON")

    async def set_ocp(self, level: float, delay: float = 0.01):
        await self.send(f"SOUR:CURR:PROT:LEV {level:.4f}")
        await self.send(f"SOUR:CURR:PROT:DEL {delay:.3f}")
        await self.send("SOUR:CURR:PROT:STAT ON")

    async def measure_voltage(self) -> float:
        r = await self.send("MEAS:VOLT?")
        return float(r) if r else 0.0

    async def measure_current(self) -> float:
        r = await self.send("MEAS:CURR?")
        return float(r) if r else 0.0

    async def measure_power(self) -> float:
        r = await self.send("MEAS:POW?")
        return float(r) if r else 0.0

    async def measure_all(self) -> dict:
        return {
            "timestamp": time.time(),
            "voltage": await self.measure_voltage(),
            "current": await self.measure_current(),
            "power": await self.measure_power(),
        }

    async def emergency_stop(self):
        """E-STOP: immediately disable output"""
        await self.send("OUTP OFF")
        await self.send("*RST")

    # --- Program (List) functions ---
    async def load_program(self, voltages: list, currents: list, durations: list, repeat: int = 1):
        """Load a multi-step program into LIST memory"""
        v_str = ",".join(f"{v:.3f}" for v in voltages)
        i_str = ",".join(f"{i:.4f}" for i in currents)
        t_str = ",".join(f"{t:.3f}" for t in durations)
        await self.send(f"LIST:VOLT {v_str}")
        await self.send(f"LIST:CURR {i_str}")
        await self.send(f"LIST:DWEL {t_str}")
        await self.send(f"LIST:COUN {repeat}")
        await self.send("LIST:STAT ON")

    async def run_program(self):
        await self.send("TRIG:SOUR BUS")
        await self.send("INIT")
        await self.send("*TRG")

    async def stop_program(self):
        await self.send("ABOR")
        await self.send("OUTP OFF")
