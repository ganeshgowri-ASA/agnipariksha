"""Humidity Freeze orchestrator - IEC 61215-2 MQT 12.

State machine: ``IDLE -> SOAK_HUMID_HOT (85 C/85%RH, 20h) -> RAMP_DOWN
-> SOAK_COLD (-40 C, 30 min) -> RAMP_UP -> CYCLE_COMPLETE`` (loop until
``cycles`` reached, then ``DONE``). Defaults follow MQT 12: 10 cycles,
85 C/-40 C, 85%RH at hot soak. Dwell times default to short values for
testability; production runs override.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from . import _enforce_basic_check


def chamber_uniformity(samples: list) -> dict:
    """Min / max / spread across a chamber sensor array (T or RH).

    MQT 12 references the maximum hot/cold spread inside the working volume;
    surface this as a single dict for display. Empty input -> None values.
    """
    if not samples:
        return {"min": None, "max": None, "spread": None}
    lo, hi = min(samples), max(samples)
    return {"min": lo, "max": hi, "spread": hi - lo}


class HFState(str, Enum):
    IDLE = "IDLE"
    SOAK_HUMID_HOT = "SOAK_HUMID_HOT"
    RAMP_DOWN = "RAMP_DOWN"
    SOAK_COLD = "SOAK_COLD"
    RAMP_UP = "RAMP_UP"
    CYCLE_COMPLETE = "CYCLE_COMPLETE"
    DONE = "DONE"


@dataclass
class HumidityFreezeOrchestrator:
    module_id: str
    isc_a: float
    cycles: int = 10
    t_hot_c: float = 85.0
    t_cold_c: float = -40.0
    rh_pct: float = 85.0
    ramp_rate_c_per_min: float = 100.0
    # MQT 12 specifies 20 h hot soak + 30 min cold soak. Short defaults
    # keep unit tests fast; production scheduling overrides via ctor.
    hot_soak_s: float = 60.0
    cold_soak_s: float = 30.0
    # Tolerance bands for the conformance check. Out-of-band readings flip
    # check_tolerance(...) to non-conformant (red NON-CONFORM in the UI).
    t_tol_c: float = 2.0
    rh_tol_pct: float = 5.0
    i_tol_pct: float = 10.0

    state: HFState = field(default=HFState.IDLE, init=False)
    cycle_index: int = field(default=0, init=False)
    temp_c: float = field(default=25.0, init=False)
    started_at_s: Optional[float] = field(default=None, init=False)
    _phase_start_s: float = field(default=0.0, init=False)
    # Manual post-test checkboxes (MQT 12 verdict inputs). None until recorded.
    visual_pass: Optional[bool] = field(default=None, init=False)
    insulation_retained: Optional[bool] = field(default=None, init=False)
    # Ramp telemetry: phase-start temperature, last tick clock and a small
    # rolling window of (now_s, temp_c) samples for the point-to-point metric.
    _phase_start_temp: float = field(default=0.0, init=False)
    _last_tick_s: float = field(default=0.0, init=False)
    _ramp_window: deque = field(default_factory=lambda: deque(maxlen=5), init=False)

    RAMP_RATE_CAP = 200.0  # internal cap, deg C / minute (sim ceiling)
    # MQT 12 permits two operator-selectable ramp rates (deg C / hour).
    ALLOWED_RAMP_C_PER_HOUR = (100, 200)
    # Small continuity-check current injected while energized, expressed as a
    # fraction of Isc (per MQT 12 leakage / continuity practice, ~0.1 % Isc).
    INJECTED_CURRENT_FRAC = 0.001

    # MQT 12 reference profile for one 24 h cycle: hot/humid dwell >= 20 h,
    # cold dwell >= 30 min, each temperature transition completes within 4 h.
    # The dwell defaults above are short for test speed; meets_spec_profile()
    # validates a production-configured run against these reference values.
    SPEC_HOT_SOAK_S = 20 * 3600
    SPEC_COLD_SOAK_S = 30 * 60
    SPEC_MAX_TRANSITION_S = 4 * 3600

    def __post_init__(self) -> None:
        if self.ramp_rate_c_per_min <= 0:
            raise ValueError("ramp_rate_c_per_min must be > 0")
        self.ramp_rate_c_per_min = min(self.ramp_rate_c_per_min, self.RAMP_RATE_CAP)
        if self.t_hot_c <= self.t_cold_c:
            raise ValueError("t_hot_c must be > t_cold_c")
        if self.cycles <= 0:
            raise ValueError("cycles must be > 0")
        if not (0 <= self.rh_pct <= 100):
            raise ValueError("rh_pct must be in [0,100]")
        self.temp_c = (self.t_hot_c + self.t_cold_c) / 2.0

    def start(self, now_s: float) -> None:
        if self.state is not HFState.IDLE:
            raise RuntimeError(f"cannot start from state {self.state}")
        # TODO(PR#52a/b): replace stub with real _enforce_basic_check
        # (interlock, OVP/OCP, chamber RH) before PSU energization.
        _enforce_basic_check()
        self.started_at_s = now_s
        self._phase_start_s = now_s
        self.temp_c = self.t_hot_c
        self.state = HFState.SOAK_HUMID_HOT

    def tick(self, now_s: float) -> HFState:
        self._last_tick_s = now_s
        if self.state in (HFState.IDLE, HFState.DONE):
            return self.state
        elapsed = now_s - self._phase_start_s
        ramp = self.ramp_rate_c_per_min / 60.0 * elapsed
        if self.state is HFState.SOAK_HUMID_HOT:
            self.temp_c = self.t_hot_c
            if elapsed >= self.hot_soak_s:
                self._advance(HFState.RAMP_DOWN, now_s)
        elif self.state is HFState.RAMP_DOWN:
            self.temp_c = max(self.t_hot_c - ramp, self.t_cold_c)
            self._ramp_window.append((now_s, self.temp_c))
            if self.temp_c <= self.t_cold_c:
                self._advance(HFState.SOAK_COLD, now_s)
        elif self.state is HFState.SOAK_COLD:
            self.temp_c = self.t_cold_c
            if elapsed >= self.cold_soak_s:
                self._advance(HFState.RAMP_UP, now_s)
        elif self.state is HFState.RAMP_UP:
            self.temp_c = min(self.t_cold_c + ramp, self.t_hot_c)
            self._ramp_window.append((now_s, self.temp_c))
            if self.temp_c >= self.t_hot_c:
                self._advance(HFState.CYCLE_COMPLETE, now_s)
        elif self.state is HFState.CYCLE_COMPLETE:
            self.cycle_index += 1
            if self.cycle_index >= self.cycles:
                self.state = HFState.DONE
            else:
                # TODO(PR#52a/b): re-check basic safety before re-
                # energizing the next humid hot soak (stub today).
                _enforce_basic_check()
                self._advance(HFState.SOAK_HUMID_HOT, now_s)
        return self.state

    def _advance(self, next_state: HFState, now_s: float) -> None:
        self.state = next_state
        self._phase_start_s = now_s
        if next_state in (HFState.RAMP_DOWN, HFState.RAMP_UP):
            self._phase_start_temp = self.temp_c
            self._ramp_window.clear()
            self._ramp_window.append((now_s, self.temp_c))

    def current_a(self) -> float:
        """MQT 12: module is short-circuited at Isc while energized."""
        if self.state in (HFState.SOAK_HUMID_HOT, HFState.RAMP_DOWN, HFState.RAMP_UP):
            return self.isc_a if self.temp_c >= 25.0 else 0.0
        return 0.0

    def rh_active_pct(self) -> float:
        """RH controlled to nominal only during the hot humid soak."""
        return self.rh_pct if self.state is HFState.SOAK_HUMID_HOT else 0.0

    @classmethod
    def with_ramp_mode(cls, *, ramp_c_per_hour: int, **kwargs) -> "HumidityFreezeOrchestrator":
        """Construct with the operator-selected ramp rate in deg C / hour.

        MQT 12 permits two ramp modes (100 or 200 deg C / hour); anything else
        is rejected at construction time. The value is converted to the
        internal deg C / minute representation."""
        if ramp_c_per_hour not in cls.ALLOWED_RAMP_C_PER_HOUR:
            raise ValueError(
                f"ramp_c_per_hour must be one of {cls.ALLOWED_RAMP_C_PER_HOUR}; got {ramp_c_per_hour}"
            )
        kwargs["ramp_rate_c_per_min"] = ramp_c_per_hour / 60.0
        return cls(**kwargs)

    @property
    def ramp_rate_c_per_h(self) -> float:
        """SET ramp rate exposed in deg C / hour for UI / report parity."""
        return self.ramp_rate_c_per_min * 60.0

    def ramp_actual_p2p_c_per_h(self) -> Optional[float]:
        """ACTUAL point-to-point |dT/dt| in deg C / hour over the rolling
        window. None outside a ramp or with fewer than two samples."""
        if self.state not in (HFState.RAMP_DOWN, HFState.RAMP_UP):
            return None
        if len(self._ramp_window) < 2:
            return None
        (t0, temp0) = self._ramp_window[0]
        (t1, temp1) = self._ramp_window[-1]
        dt_h = (t1 - t0) / 3600.0
        if dt_h <= 0:
            return None
        return abs(temp1 - temp0) / dt_h

    def ramp_actual_cumulative_c_per_h(self) -> Optional[float]:
        """ACTUAL cumulative |ΔT/Δt| in deg C / hour from phase-start to the
        last tick. None outside a ramp."""
        if self.state not in (HFState.RAMP_DOWN, HFState.RAMP_UP):
            return None
        elapsed_h = (self._last_tick_s - self._phase_start_s) / 3600.0
        if elapsed_h <= 0:
            return None
        return abs(self.temp_c - self._phase_start_temp) / elapsed_h

    def injected_current_a(self) -> float:
        """Small continuity-check current (~0.1 % Isc) while energized."""
        if self.state in (HFState.SOAK_HUMID_HOT, HFState.RAMP_DOWN, HFState.RAMP_UP):
            return self.INJECTED_CURRENT_FRAC * self.isc_a
        return 0.0

    def check_tolerance(self, *, measured_t_c: float, measured_rh_pct: float,
                        measured_i_a: float) -> dict:
        """Per-channel tolerance check. ``conformant=False`` -> red NON-CONFORM.

        T is compared to the current setpoint (``temp_c``), RH to the current
        active RH (zero outside the hot soak), and current to the injected
        ~0.1 %-Isc reference; a tiny absolute floor avoids zero-divide noise
        in the de-energised phases."""
        t_ok = abs(measured_t_c - self.temp_c) <= self.t_tol_c
        rh_ok = abs(measured_rh_pct - self.rh_active_pct()) <= self.rh_tol_pct
        i_ref = self.injected_current_a()
        i_tol_a = max(self.i_tol_pct / 100.0 * abs(i_ref), 1e-6)
        i_ok = abs(measured_i_a - i_ref) <= i_tol_a
        return {"t_ok": t_ok, "rh_ok": rh_ok, "i_ok": i_ok,
                "conformant": t_ok and rh_ok and i_ok}

    @property
    def transition_s(self) -> float:
        """Seconds for one full hot<->cold swing at the configured ramp."""
        return (self.t_hot_c - self.t_cold_c) / (self.ramp_rate_c_per_min / 60.0)

    def meets_spec_profile(self) -> bool:
        """True when dwell/transition timings conform to the MQT 12 reference."""
        return (
            self.hot_soak_s >= self.SPEC_HOT_SOAK_S
            and self.cold_soak_s >= self.SPEC_COLD_SOAK_S
            and self.transition_s <= self.SPEC_MAX_TRANSITION_S
        )

    def record_inspection(self, *, visual_pass: bool, insulation_retained: bool) -> None:
        """Record the two manual MQT 12 verdict inputs (UI checkboxes)."""
        self.visual_pass = bool(visual_pass)
        self.insulation_retained = bool(insulation_retained)

    def verdict(self) -> str:
        """MQT 12 verdict. PENDING until all cycles complete AND both manual
        checks are recorded; then PASS only if visual inspection passed and
        insulation resistance was retained, otherwise FAIL."""
        if self.state is not HFState.DONE:
            return "PENDING"
        if self.visual_pass is None or self.insulation_retained is None:
            return "PENDING"
        return "PASS" if (self.visual_pass and self.insulation_retained) else "FAIL"

    def to_dict(self) -> dict:
        return {
            "module_id": self.module_id,
            "state": self.state.value,
            "cycle_index": self.cycle_index,
            "cycles": self.cycles,
            "temp_c": round(self.temp_c, 2),
            "rh_pct": round(self.rh_active_pct(), 1),
            "isc_a": self.isc_a,
            "current_a": round(self.current_a(), 4),
            "ramp_rate_c_per_min": self.ramp_rate_c_per_min,
            "ramp_rate_c_per_h": round(self.ramp_rate_c_per_h, 2),
            "ramp_actual_p2p_c_per_h": self.ramp_actual_p2p_c_per_h(),
            "ramp_actual_cumulative_c_per_h": self.ramp_actual_cumulative_c_per_h(),
            "injected_current_a": round(self.injected_current_a(), 6),
            "tolerance_bands": {"t_c": self.t_tol_c,
                                "rh_pct": self.rh_tol_pct,
                                "i_pct": self.i_tol_pct},
            "started_at_s": self.started_at_s,
            "visual_pass": self.visual_pass,
            "insulation_retained": self.insulation_retained,
            "verdict": self.verdict(),
        }
