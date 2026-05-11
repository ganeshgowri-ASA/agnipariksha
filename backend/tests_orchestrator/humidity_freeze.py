"""Humidity-Freeze orchestrator — IEC 61215-2 MQT 12.

Profile per clause 12.5:
    - 10 cycles
    - Hot phase: +85 C / 85 %RH, Isc injected
    - Freeze phase: -40 C, current off
    - Transition <30 min, dwells default to 20 h at each extreme
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, Optional

from .base import BaseOrchestrator, ComplianceResult, _sleep_or_stop
from .compliance import validate_humidity_freeze


class HumidityFreezeOrchestrator(BaseOrchestrator):
    STANDARD = "IEC 61215-2 MQT 12"
    NAME = "humidity_freeze"

    DEFAULT_CYCLES = 10
    DEFAULT_HOT_DWELL_S = 20 * 3600
    DEFAULT_COLD_DWELL_S = 20 * 3600
    DEFAULT_TRANSITION_S = 30 * 60

    async def start(self, params: Optional[Dict[str, Any]] = None) -> str:
        p = dict(params or {})
        p.setdefault("voc", 45.0)
        p.setdefault("isc", 9.5)
        p.setdefault("cycles", self.DEFAULT_CYCLES)
        p.setdefault("hot_dwell_s", self.DEFAULT_HOT_DWELL_S)
        p.setdefault("cold_dwell_s", self.DEFAULT_COLD_DWELL_S)
        p.setdefault("transition_s", self.DEFAULT_TRANSITION_S)

        self.duration_s = float(p["cycles"]) * (
            p["hot_dwell_s"] + p["cold_dwell_s"] + 2 * p["transition_s"]
        )
        self.cycles_completed = 0
        return await super().start(p)

    async def _run(self):
        p = self.params
        voc, isc = float(p["voc"]), float(p["isc"])
        cycles = int(p["cycles"])

        await self._drv_call("set_ovp", voc * 1.1)
        await self._drv_call("set_ocp", isc * 1.15)

        for c in range(cycles):
            if self._stop_event.is_set():
                break

            self.step = f"transition_to_hot:{c+1}/{cycles}"
            await self._drv_call("set_voltage", voc)
            await self._drv_call("set_current", isc * 0.1)
            await self._drv_call("output_on")
            await self._dwell(float(p["transition_s"]))

            self.step = f"hot:{c+1}/{cycles}"
            await self._drv_call("set_current", isc)
            await self._dwell(float(p["hot_dwell_s"]))
            if self._stop_event.is_set():
                break

            self.step = f"transition_to_freeze:{c+1}/{cycles}"
            await self._drv_call("set_current", 0.0)
            await self._dwell(float(p["transition_s"]))

            self.step = f"freeze:{c+1}/{cycles}"
            await self._drv_call("output_off")
            await self._dwell(float(p["cold_dwell_s"]))
            self.cycles_completed = c + 1
            await self._drv_call("output_on")

        self.step = "done"
        await self._drv_call("output_off")

    async def _dwell(self, seconds: float) -> None:
        if seconds <= 0:
            return
        remaining = seconds
        while remaining > 0:
            if self._stop_event.is_set():
                return
            chunk = min(self.sample_interval_s, remaining)
            await self._measure(self.step)
            if await _sleep_or_stop(self._stop_event, chunk):
                return
            remaining -= chunk

    def validate(self) -> ComplianceResult:
        return validate_humidity_freeze(
            self._samples_log,
            cycles_completed=self.cycles_completed,
            cycles_target=int(self.params.get("cycles", self.DEFAULT_CYCLES)),
            isc=float(self.params.get("isc", 0.0)),
        )
