"""Thermal Cycling orchestrator - IEC 61215-2 MQT 11.

State machine: ``IDLE -> SOAK_HOT -> RAMP_DOWN -> SOAK_COLD -> RAMP_UP
-> CYCLE_COMPLETE`` (loop until ``cycles`` reached, then ``DONE``).
Defaults follow MQT 11: 200 cycles, -40 .. +85 C, ramp <= 100 C/min.
Dwell defaults to 60 s for testability; production runs override.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from . import _enforce_basic_check


class TCState(str, Enum):
    IDLE = "IDLE"
    SOAK_HOT = "SOAK_HOT"
    RAMP_DOWN = "RAMP_DOWN"
    SOAK_COLD = "SOAK_COLD"
    RAMP_UP = "RAMP_UP"
    CYCLE_COMPLETE = "CYCLE_COMPLETE"
    DONE = "DONE"


@dataclass
class ThermalCyclingOrchestrator:
    module_id: str
    isc_a: float
    cycles: int = 200
    t_hot_c: float = 85.0
    t_cold_c: float = -40.0
    ramp_rate_c_per_min: float = 100.0
    dwell_s: float = 60.0

    state: TCState = field(default=TCState.IDLE, init=False)
    cycle_index: int = field(default=0, init=False)
    temp_c: float = field(default=25.0, init=False)
    started_at_s: Optional[float] = field(default=None, init=False)
    _phase_start_s: float = field(default=0.0, init=False)

    RAMP_RATE_CAP = 100.0  # MQT 11 ceiling

    def __post_init__(self) -> None:
        if self.ramp_rate_c_per_min <= 0:
            raise ValueError("ramp_rate_c_per_min must be > 0")
        self.ramp_rate_c_per_min = min(self.ramp_rate_c_per_min, self.RAMP_RATE_CAP)
        if self.t_hot_c <= self.t_cold_c:
            raise ValueError("t_hot_c must be > t_cold_c")
        if self.cycles <= 0:
            raise ValueError("cycles must be > 0")
        self.temp_c = (self.t_hot_c + self.t_cold_c) / 2.0

    def start(self, now_s: float) -> None:
        if self.state is not TCState.IDLE:
            raise RuntimeError(f"cannot start from state {self.state}")
        # TODO(PR#52a/b): replace stub with real _enforce_basic_check
        # (interlock, OVP/OCP, ground bond) before PSU energization.
        _enforce_basic_check()
        self.started_at_s = now_s
        self._phase_start_s = now_s
        self.temp_c = self.t_hot_c
        self.state = TCState.SOAK_HOT

    def tick(self, now_s: float) -> TCState:
        if self.state in (TCState.IDLE, TCState.DONE):
            return self.state
        elapsed = now_s - self._phase_start_s
        ramp = self.ramp_rate_c_per_min / 60.0 * elapsed
        if self.state is TCState.SOAK_HOT:
            self.temp_c = self.t_hot_c
            if elapsed >= self.dwell_s:
                self._advance(TCState.RAMP_DOWN, now_s)
        elif self.state is TCState.RAMP_DOWN:
            self.temp_c = max(self.t_hot_c - ramp, self.t_cold_c)
            if self.temp_c <= self.t_cold_c:
                self._advance(TCState.SOAK_COLD, now_s)
        elif self.state is TCState.SOAK_COLD:
            self.temp_c = self.t_cold_c
            if elapsed >= self.dwell_s:
                self._advance(TCState.RAMP_UP, now_s)
        elif self.state is TCState.RAMP_UP:
            self.temp_c = min(self.t_cold_c + ramp, self.t_hot_c)
            if self.temp_c >= self.t_hot_c:
                self._advance(TCState.CYCLE_COMPLETE, now_s)
        elif self.state is TCState.CYCLE_COMPLETE:
            self.cycle_index += 1
            if self.cycle_index >= self.cycles:
                self.state = TCState.DONE
            else:
                # TODO(PR#52a/b): re-check basic safety before
                # re-energizing the next hot soak (stub today).
                _enforce_basic_check()
                self._advance(TCState.SOAK_HOT, now_s)
        return self.state

    def _advance(self, next_state: TCState, now_s: float) -> None:
        self.state = next_state
        self._phase_start_s = now_s

    _ENERGIZED = (TCState.SOAK_HOT, TCState.RAMP_DOWN, TCState.RAMP_UP)

    def current_a(self) -> float:
        """MQT 11: I = Isc when T >= 25 C and energized, else 0."""
        if self.temp_c >= 25.0 and self.state in self._ENERGIZED:
            return self.isc_a
        return 0.0

    def to_dict(self) -> dict:
        return {
            "module_id": self.module_id,
            "state": self.state.value,
            "cycle_index": self.cycle_index,
            "cycles": self.cycles,
            "temp_c": round(self.temp_c, 2),
            "isc_a": self.isc_a,
            "current_a": round(self.current_a(), 4),
            "ramp_rate_c_per_min": self.ramp_rate_c_per_min,
            "started_at_s": self.started_at_s,
        }
