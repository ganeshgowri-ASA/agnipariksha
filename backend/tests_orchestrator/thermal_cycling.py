"""Thermal Cycling orchestrator — IEC 61215-2 MQT 11.

Cycle profile per clause 11.5:
    - Temperature: -40 C to +85 C
    - Cycle count: 200 (qualification)
    - Heating phase: inject Isc through the module
    - Cooling phase: current off (module rests at Voc bias)

The orchestrator does not control the thermal chamber directly — it
mirrors the chamber's hot/cold dwell schedule and drives the PV6000
accordingly, so an external chamber controller can synchronise by
pacing wall-clock time.
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, Optional

from .base import (
    BaseOrchestrator,
    ComplianceResult,
    OrchestratorState,
    _sleep_or_stop,
)
from .compliance import validate_thermal_cycling


class ThermalCyclingOrchestrator(BaseOrchestrator):
    STANDARD = "IEC 61215-2 MQT 11"
    NAME = "thermal_cycling"

    DEFAULT_CYCLES = 200
    DEFAULT_HOT_DWELL_S = 600
    DEFAULT_COLD_DWELL_S = 600
    DEFAULT_RAMP_S = 60

    async def start(self, params: Optional[Dict[str, Any]] = None) -> str:
        p = dict(params or {})
        p.setdefault("voc", 45.0)
        p.setdefault("isc", 9.5)
        p.setdefault("cycles", self.DEFAULT_CYCLES)
        p.setdefault("hot_dwell_s", self.DEFAULT_HOT_DWELL_S)
        p.setdefault("cold_dwell_s", self.DEFAULT_COLD_DWELL_S)
        p.setdefault("ramp_s", self.DEFAULT_RAMP_S)

        self.duration_s = float(p["cycles"]) * (
            p["hot_dwell_s"] + p["cold_dwell_s"] + 2 * p["ramp_s"]
        )
        self.cycles_completed = 0
        return await super().start(p)

    async def _run(self):
        p = self.params
        voc, isc = float(p["voc"]), float(p["isc"])
        cycles = int(p["cycles"])
        hot_s = float(p["hot_dwell_s"])
        cold_s = float(p["cold_dwell_s"])
        ramp_s = float(p["ramp_s"])

        await self._drv_call("set_ovp", voc * 1.1)
        await self._drv_call("set_ocp", isc * 1.15)

        for c in range(cycles):
            if self._stop_event.is_set():
                break

            # Ramp up to +85 C: hold modest current to track chamber.
            self.step = f"ramp_up:{c+1}/{cycles}"
            await self._drv_call("set_voltage", voc)
            await self._drv_call("set_current", isc * 0.1)
            await self._drv_call("output_on")
            await self._dwell(ramp_s)

            # Hot dwell with Isc injection.
            self.step = f"hot:{c+1}/{cycles}"
            await self._drv_call("set_current", isc)
            await self._dwell(hot_s)
            if self._stop_event.is_set():
                break

            # Ramp down to -40 C: current off.
            self.step = f"ramp_down:{c+1}/{cycles}"
            await self._drv_call("set_current", 0.0)
            await self._drv_call("set_voltage", 0.1)
            await self._dwell(ramp_s)

            # Cold dwell, output off.
            self.step = f"cold:{c+1}/{cycles}"
            await self._drv_call("output_off")
            await self._dwell(cold_s)
            self.cycles_completed = c + 1

            await self._drv_call("output_on")

        self.step = "done"
        await self._drv_call("output_off")

    async def _dwell(self, seconds: float) -> None:
        """Sleep the given duration in sample-interval chunks, emitting a
        sample on each chunk. Honours the stop event."""
        if seconds <= 0:
            return
        remaining = seconds
        while remaining > 0:
            if self._stop_event.is_set():
                return
            chunk = min(self.sample_interval_s, remaining)
            await self._measure(self.step)
            stopped = await _sleep_or_stop(self._stop_event, chunk)
            if stopped:
                return
            remaining -= chunk

    def validate(self) -> ComplianceResult:
        return validate_thermal_cycling(
            self._samples_log,
            cycles_completed=self.cycles_completed,
            cycles_target=int(self.params.get("cycles", self.DEFAULT_CYCLES)),
            isc=float(self.params.get("isc", 0.0)),
        )
