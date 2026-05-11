"""Bypass-Diode Thermal Test orchestrator — IEC 62979.

Clause 8: drive 1.35 x Isc through the bypass-diode string for 1 h
and watch for thermal runaway. We declare runaway if the measured
forward voltage exceeds ``vf_limit_per_diode`` * ``num_diodes``.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from .base import BaseOrchestrator, ComplianceResult, _sleep_or_stop
from .compliance import validate_bypass_diode


class BypassDiodeOrchestrator(BaseOrchestrator):
    STANDARD = "IEC 62979"
    NAME = "bypass_diode"

    DEFAULT_DURATION_S = 3600.0
    DEFAULT_CURRENT_MULTIPLIER = 1.35
    DEFAULT_VF_LIMIT_PER_DIODE = 0.7

    async def start(self, params: Optional[Dict[str, Any]] = None) -> str:
        p = dict(params or {})
        p.setdefault("isc", 9.5)
        p.setdefault("num_diodes", 3)
        p.setdefault("duration_s", self.DEFAULT_DURATION_S)
        p.setdefault("current_multiplier", self.DEFAULT_CURRENT_MULTIPLIER)
        p.setdefault("vf_limit_per_diode", self.DEFAULT_VF_LIMIT_PER_DIODE)
        p["test_current_a"] = round(p["isc"] * p["current_multiplier"], 4)
        self.duration_s = float(p["duration_s"])
        self.elapsed_s = 0.0
        self.runaway_detected = False
        return await super().start(p)

    async def _run(self):
        p = self.params
        i_test = float(p["test_current_a"])
        v_compliance = float(p["num_diodes"]) * 1.5  # headroom per diode

        await self._drv_call("set_ovp", v_compliance * 1.1)
        await self._drv_call("set_ocp", i_test * 1.1)
        await self._drv_call("set_voltage", v_compliance)
        await self._drv_call("set_current", i_test)
        await self._drv_call("output_on")

        self.step = "soak"
        vf_limit = float(p["vf_limit_per_diode"]) * int(p["num_diodes"])
        remaining = self.duration_s
        while remaining > 0 and not self._stop_event.is_set():
            sample = await self._measure("soak")
            if sample.voltage > vf_limit:
                self.runaway_detected = True
                break
            chunk = min(self.sample_interval_s, remaining)
            if await _sleep_or_stop(self._stop_event, chunk):
                break
            remaining -= chunk

        self.elapsed_s = self.duration_s - remaining
        self.step = "done"
        await self._drv_call("output_off")

    def validate(self) -> ComplianceResult:
        return validate_bypass_diode(
            self._samples_log,
            elapsed_s=self.elapsed_s,
            duration_s_target=float(self.params.get("duration_s", self.DEFAULT_DURATION_S)),
            vf_limit_per_diode=float(self.params.get("vf_limit_per_diode",
                                                     self.DEFAULT_VF_LIMIT_PER_DIODE)),
            num_diodes=int(self.params.get("num_diodes", 3)),
        )
