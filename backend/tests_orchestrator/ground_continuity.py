"""Ground Continuity orchestrator — IEC 61730-2 MST 13.

Clause 10.5.1: drive 2.5 x rated current (default 25 A for a 10-A rated
module) between frame and earth, measure voltage drop, compute R = V/I,
and pass if R < 0.1 ohm.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from .base import BaseOrchestrator, ComplianceResult, _sleep_or_stop
from .compliance import validate_ground_continuity


class GroundContinuityOrchestrator(BaseOrchestrator):
    STANDARD = "IEC 61730-2 MST 13"
    NAME = "ground_continuity"

    DEFAULT_RATED_CURRENT_A = 10.0
    DEFAULT_MULTIPLIER = 2.5
    DEFAULT_VOLTAGE_LIMIT_V = 6.0
    DEFAULT_LIMIT_OHM = 0.1
    STABILISE_S = 5.0
    MEASURE_WINDOW_S = 5.0

    async def start(self, params: Optional[Dict[str, Any]] = None) -> str:
        p = dict(params or {})
        p.setdefault("rated_current_a", self.DEFAULT_RATED_CURRENT_A)
        p.setdefault("multiplier", self.DEFAULT_MULTIPLIER)
        p.setdefault("voltage_limit_v", self.DEFAULT_VOLTAGE_LIMIT_V)
        p.setdefault("limit_ohm", self.DEFAULT_LIMIT_OHM)
        p["test_current_a"] = round(p["rated_current_a"] * p["multiplier"], 4)
        self.duration_s = self.STABILISE_S + self.MEASURE_WINDOW_S
        self.resistance_ohm: float = float("nan")
        return await super().start(p)

    async def _run(self):
        p = self.params
        i_test = float(p["test_current_a"])
        v_lim = float(p["voltage_limit_v"])

        await self._drv_call("set_ovp", v_lim * 1.1)
        await self._drv_call("set_ocp", i_test * 1.1)
        await self._drv_call("set_voltage", v_lim)
        await self._drv_call("set_current", i_test)
        await self._drv_call("output_on")

        self.step = "stabilise"
        remaining = self.STABILISE_S
        while remaining > 0 and not self._stop_event.is_set():
            await self._measure("stabilise")
            chunk = min(self.sample_interval_s, remaining)
            if await _sleep_or_stop(self._stop_event, chunk):
                break
            remaining -= chunk

        self.step = "measure"
        readings: list[tuple[float, float]] = []
        remaining = self.MEASURE_WINDOW_S
        while remaining > 0 and not self._stop_event.is_set():
            s = await self._measure("measure")
            if abs(s.current) > 0.1:
                readings.append((s.voltage, s.current))
            chunk = min(self.sample_interval_s, remaining)
            if await _sleep_or_stop(self._stop_event, chunk):
                break
            remaining -= chunk

        if readings:
            mean_v = sum(v for v, _ in readings) / len(readings)
            mean_i = sum(i for _, i in readings) / len(readings)
            self.resistance_ohm = mean_v / mean_i if mean_i else float("inf")

        self.step = "done"
        await self._drv_call("output_off")

    def validate(self) -> ComplianceResult:
        return validate_ground_continuity(
            resistance_ohm=self.resistance_ohm,
            test_current_a=float(self.params.get("test_current_a", 0.0)),
            rated_current_a=float(self.params.get("rated_current_a",
                                                  self.DEFAULT_RATED_CURRENT_A)),
            limit_ohm=float(self.params.get("limit_ohm", self.DEFAULT_LIMIT_OHM)),
            # IEC 61730-2 MST 13 mandates 2.5 x rated; the validator must
            # compare against the standard's requirement regardless of what
            # multiplier the operator actually drove the supply at.
            required_current_multiplier=self.DEFAULT_MULTIPLIER,
        )
