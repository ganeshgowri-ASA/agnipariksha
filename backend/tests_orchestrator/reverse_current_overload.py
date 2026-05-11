"""Reverse-Current Overload orchestrator — IEC 61730-2 MST 26.

Clause 10.13: source 135 % of the string overcurrent protection rating
in reverse through the module for 2 h, watching for the protective
fuse to open. Pass requires the test to run to completion without the
fuse opening and without thermal incident.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from .base import BaseOrchestrator, ComplianceResult, _sleep_or_stop
from .compliance import validate_reverse_current_overload


class ReverseCurrentOverloadOrchestrator(BaseOrchestrator):
    STANDARD = "IEC 61730-2 MST 26"
    NAME = "reverse_current_overload"

    DEFAULT_FUSE_MULTIPLIER = 1.35
    DEFAULT_DURATION_S = 2 * 3600.0
    DEFAULT_REVERSE_VOLTAGE = 40.0
    FUSE_OPEN_CURRENT_THRESHOLD = 0.5  # |I| below this for >2 s = fuse open

    async def start(self, params: Optional[Dict[str, Any]] = None) -> str:
        p = dict(params or {})
        p.setdefault("fuse_rating_a", 15.0)
        p.setdefault("multiplier", self.DEFAULT_FUSE_MULTIPLIER)
        p.setdefault("duration_s", self.DEFAULT_DURATION_S)
        p.setdefault("reverse_voltage", self.DEFAULT_REVERSE_VOLTAGE)
        p["test_current_a"] = round(p["fuse_rating_a"] * p["multiplier"], 4)
        self.duration_s = float(p["duration_s"])
        self.elapsed_s = 0.0
        self.fuse_blew = False
        return await super().start(p)

    async def _run(self):
        p = self.params
        i_rev = float(p["test_current_a"])
        v_rev = float(p["reverse_voltage"])

        await self._drv_call("set_ovp", v_rev * 1.2)
        await self._drv_call("set_ocp", i_rev * 1.2)
        await self._drv_call("set_voltage", v_rev)
        # Negative current = reverse source; drivers without polarity
        # support treat magnitude only — compliance still inspects |I|.
        await self._drv_call("set_current", -i_rev)
        await self._drv_call("output_on")

        self.step = "overload"
        remaining = self.duration_s
        low_current_streak = 0.0
        # Stop declaring a fuse-open as soon as the streak exceeds this
        # short window — long enough to ignore initial settling, short
        # enough to catch a real open in synthetic test runs.
        startup_settle_s = max(self.sample_interval_s * 2, 0.005)
        while remaining > 0 and not self._stop_event.is_set():
            sample = await self._measure("overload")
            run_elapsed = self.duration_s - remaining
            if (abs(sample.current) < self.FUSE_OPEN_CURRENT_THRESHOLD
                    and run_elapsed > startup_settle_s):
                low_current_streak += self.sample_interval_s
                if low_current_streak >= startup_settle_s:
                    self.fuse_blew = True
                    break
            else:
                low_current_streak = 0.0

            chunk = min(self.sample_interval_s, remaining)
            if await _sleep_or_stop(self._stop_event, chunk):
                break
            remaining -= chunk

        self.elapsed_s = self.duration_s - remaining
        self.step = "done"
        await self._drv_call("output_off")

    def validate(self) -> ComplianceResult:
        return validate_reverse_current_overload(
            self._samples_log,
            elapsed_s=self.elapsed_s,
            duration_s_target=float(self.params.get("duration_s", self.DEFAULT_DURATION_S)),
            test_current_a=float(self.params.get("test_current_a", 0.0)),
            fuse_blew=self.fuse_blew,
        )
