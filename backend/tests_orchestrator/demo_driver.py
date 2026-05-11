"""In-process driver used for tests and the UI demo mode.

Models the PV6000 as a Thevenin source with a configurable load
behavior. Measurements track the most recent setpoints with a small
amount of noise so that the orchestrators' sample streams look real.
"""
from __future__ import annotations

import asyncio
import random
import time
from typing import Optional


class DemoDriver:
    def __init__(self, *, noise: float = 0.005, settle_s: float = 0.0):
        self.noise = noise
        self.settle_s = settle_s

        self._v_set: float = 0.0
        self._i_set: float = 0.0
        self._ovp: float = 1000.0
        self._ocp: float = 100.0
        self._output: bool = False
        self._last_change: float = time.monotonic()

        # Optional fault injection used by tests.
        self.simulate_fuse_open_after_s: Optional[float] = None
        self.simulate_resistance_ohm: Optional[float] = None
        self._start_t: float = time.monotonic()

    # --------------------------------------------------------------- setpoints
    async def set_voltage(self, v: float) -> None:
        self._v_set = float(v)
        self._last_change = time.monotonic()

    async def set_current(self, i: float) -> None:
        self._i_set = float(i)
        self._last_change = time.monotonic()

    async def set_ovp(self, v: float) -> None:
        self._ovp = float(v)

    async def set_ocp(self, i: float) -> None:
        self._ocp = float(i)

    async def output_on(self) -> None:
        self._output = True
        self._start_t = time.monotonic()

    async def output_off(self) -> None:
        self._output = False
        self._v_set = 0.0
        self._i_set = 0.0

    # --------------------------------------------------------------- measurements
    def _noisy(self, value: float) -> float:
        if value == 0.0:
            return random.gauss(0.0, self.noise)
        return value * (1.0 + random.gauss(0.0, self.noise))

    async def measure_voltage(self) -> float:
        if not self._output:
            return 0.0
        if self.simulate_resistance_ohm is not None:
            v = abs(self._i_set) * self.simulate_resistance_ohm
            return self._noisy(min(v, self._v_set or v))
        return self._noisy(self._v_set)

    async def measure_current(self) -> float:
        if not self._output:
            return 0.0
        if self.simulate_fuse_open_after_s is not None:
            if time.monotonic() - self._start_t >= self.simulate_fuse_open_after_s:
                return self._noisy(0.0)
        return self._noisy(self._i_set)

    async def measure_power(self) -> float:
        v = await self.measure_voltage()
        i = await self.measure_current()
        return v * i

    # The orchestrators don't depend on these, but keep symmetry with SCPIDriver.
    async def connect(self) -> str:
        return "DEMO,PV6000,SIMULATED,0.0"

    async def disconnect(self) -> None:
        await self.output_off()
