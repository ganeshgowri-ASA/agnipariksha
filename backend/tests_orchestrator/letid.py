"""LeTID orchestrator — IEC TS 63342.

Light and elevated Temperature Induced Degradation. Clause 6.2/6.3:
    - 75 C +- 3 C
    - Dark current Idark = Isc - Imp at Vmpp
    - Duration: 162 h
    - Periodic measurement every 2 h (default)
    - Drift on Idark must remain within +-0.5 %.
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, Optional

from .base import BaseOrchestrator, ComplianceResult, _sleep_or_stop
from .compliance import validate_letid


class LeTIDOrchestrator(BaseOrchestrator):
    STANDARD = "IEC TS 63342"
    NAME = "letid"

    DEFAULT_DURATION_H = 162.0
    DEFAULT_MEAS_INTERVAL_S = 7200.0  # 2 h
    TEMP_TARGET_C = 75.0
    TEMP_TOLERANCE_C = 3.0

    @staticmethod
    def calculate_idark(isc: float, imp: float) -> float:
        return round(isc - imp, 6)

    async def start(self, params: Optional[Dict[str, Any]] = None) -> str:
        p = dict(params or {})
        p.setdefault("voc", 45.0)
        p.setdefault("vmpp", 37.5)
        p.setdefault("isc", 9.5)
        p.setdefault("imp", 8.9)
        p.setdefault("duration_h", self.DEFAULT_DURATION_H)
        p.setdefault("meas_interval_s", self.DEFAULT_MEAS_INTERVAL_S)
        p["idark"] = self.calculate_idark(float(p["isc"]), float(p["imp"]))

        self.duration_s = float(p["duration_h"]) * 3600.0
        self.elapsed_h = 0.0
        return await super().start(p)

    async def _run(self):
        p = self.params
        idark = float(p["idark"])
        if idark <= 0:
            raise ValueError(f"Idark must be > 0; got Isc={p['isc']} Imp={p['imp']}")

        await self._drv_call("set_ovp", float(p["voc"]) * 1.05)
        await self._drv_call("set_ocp", float(p["isc"]) * 1.10)
        await self._drv_call("set_voltage", float(p["vmpp"]))
        await self._drv_call("set_current", idark)
        await self._drv_call("output_on")

        self.step = "soak"
        interval = float(p["meas_interval_s"])
        # Use the smaller of sample_interval_s and meas_interval_s so the
        # sample stream stays responsive in tests while real runs respect
        # the 2-h measurement cadence per IEC TS 63342 clause 6.3.
        chunk = min(self.sample_interval_s, interval)

        remaining = self.duration_s
        while remaining > 0 and not self._stop_event.is_set():
            await self._measure("soak")
            wait = min(chunk, remaining)
            stopped = await _sleep_or_stop(self._stop_event, wait)
            remaining -= wait
            if stopped:
                break
        self.elapsed_h = (self.duration_s - remaining) / 3600.0

        self.step = "done"
        await self._drv_call("output_off")

    def validate(self) -> ComplianceResult:
        return validate_letid(
            self._samples_log,
            duration_h_target=float(self.params.get("duration_h", self.DEFAULT_DURATION_H)),
            elapsed_h=self.elapsed_h,
            idark_target=float(self.params.get("idark", 0.0)),
        )
