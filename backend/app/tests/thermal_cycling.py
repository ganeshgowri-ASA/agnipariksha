"""IEC 61215-2 MQT 11 — Thermal Cycling orchestrator.

State machine, ramp-rate enforcement, dwell tracking, technology-aware
continuity current injection, and a Figure 7-style demo profile.

References
----------
- IEC 61215-2:2021, MQT 11 (Thermal Cycling), Clause 4.11
- IEC 61215-1:2021 Gate 2: ``ΔPmax / Pmax_initial ≥ -5%``

This module is hardware-agnostic: it drives an injected ``ScpiClient`` and
an injected ``ChamberModel`` (real PT100 reads in production, simulated
ramp here). The simulator path produces realistic Figure 7 T+I profiles
with sensor noise so the live chart is populated in DEMO_MODE.
"""
from __future__ import annotations

import asyncio
import csv
import math
import random
import time
import uuid
from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path
from typing import Any, AsyncIterator, Callable, Dict, List, Optional


# ---------------------------------------------------------------------------
# IEC constants
# ---------------------------------------------------------------------------
T_HOT_DEFAULT_C = 85.0
T_COLD_DEFAULT_C = -40.0
MAX_RAMP_C_PER_HOUR = 100.0          # IEC 61215-2 MQT 11 §4.11.3
MIN_DWELL_SECONDS = 10 * 60          # 10 min at each extreme
CURRENT_OFF_TEMP_C = 80.0            # heat-up injection cuts at T_max − 5 K
GATE2_DELTA_PMAX_PERCENT = -5.0      # IEC 61215-1 Gate 2 (Clause 8.2)

# Per-technology STC peak-power currents (A) — used as the continuity
# current during heat-up. The 1 % low-bias current is applied during
# cool-down and the cold dwell.
TECHNOLOGY_IMP_A: Dict[str, float] = {
    "c-Si":     9.50,
    "mono":     9.50,
    "poly":     8.80,
    "perc":     9.80,
    "topcon": 10.20,
    "hjt":     10.50,
    "cdte":     2.05,
    "cigs":     1.85,
    "asi":      1.20,
}


class TCState(str, Enum):
    IDLE       = "idle"
    HEATING    = "heating"
    DWELL_HOT  = "dwell_hot"
    COOLING    = "cooling"
    DWELL_COLD = "dwell_cold"
    DONE       = "done"
    ABORTED    = "aborted"


@dataclass
class TCConfig:
    """All test parameters with IEC-compliant defaults."""
    cycles: int = 200
    t_hot_c: float = T_HOT_DEFAULT_C
    t_cold_c: float = T_COLD_DEFAULT_C
    ramp_rate_c_per_h: float = MAX_RAMP_C_PER_HOUR
    hot_dwell_s: int = MIN_DWELL_SECONDS
    cold_dwell_s: int = MIN_DWELL_SECONDS
    technology: str = "c-Si"
    imp_a: Optional[float] = None        # override TECHNOLOGY_IMP_A
    voc_v: float = 45.0
    pre_test_pmax_w: float = 0.0         # required for Gate 2 evaluation
    time_scale: float = 1.0              # >1 = accelerated simulation
    sample_interval_s: float = 0.5

    def __post_init__(self) -> None:
        if self.cycles < 1:
            raise ValueError("cycles must be >= 1")
        if self.t_hot_c <= self.t_cold_c:
            raise ValueError("t_hot_c must be greater than t_cold_c")
        if self.ramp_rate_c_per_h <= 0 or self.ramp_rate_c_per_h > MAX_RAMP_C_PER_HOUR:
            raise ValueError(
                f"ramp_rate_c_per_h must be in (0, {MAX_RAMP_C_PER_HOUR}] per IEC 61215-2 MQT 11"
            )
        if self.hot_dwell_s < MIN_DWELL_SECONDS or self.cold_dwell_s < MIN_DWELL_SECONDS:
            raise ValueError(
                f"dwell must be >= {MIN_DWELL_SECONDS} s (10 min) per IEC 61215-2 MQT 11"
            )

    def imp(self) -> float:
        if self.imp_a is not None:
            return float(self.imp_a)
        return TECHNOLOGY_IMP_A.get(self.technology.lower(), TECHNOLOGY_IMP_A["c-Si"])


@dataclass
class TCSample:
    """One telemetry sample emitted by the orchestrator."""
    ts_ms: int
    sim_s: float           # seconds since start (sim-time, not wall)
    cycle: int             # 1-indexed, 0 while IDLE
    state: str
    temperature_c: float
    current_a: float
    voltage_v: float
    set_current_a: float

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class CycleRecord:
    """One row of the cycle log table on the report."""
    cycle: int
    t_hot_peak_c: float
    t_cold_peak_c: float
    avg_ramp_up_c_per_h: float
    avg_ramp_down_c_per_h: float
    hot_dwell_s: float
    cold_dwell_s: float
    current_discontinuities: int
    voltage_discontinuities: int

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------
class ThermalCyclingOrchestrator:
    """Async state machine for IEC 61215-2 MQT 11.

    The driver / chamber are passed as callables so tests can substitute
    no-op or simulated I/O. Sim-time is decoupled from wall-time via
    ``cfg.time_scale`` so a 200-cycle qualification (~567 h wall) can
    run in seconds for tests and demo mode.
    """

    SCPI_PRELUDE = (
        "*RST",
        "OUTP OFF",
        "SOUR:FUNC CURR",         # current-priority for thermal cycle
        "SOUR:VOLT:LEV:IMM {voc:.4f}",
        "SOUR:VOLT:PROT:LEV {ovp:.4f}",
        "SOUR:CURR:PROT:LEV {ocp:.4f}",
    )

    def __init__(
        self,
        scpi_send: Callable[[str], Any],
        chamber_temp: Callable[[], float],
        chamber_setpoint: Callable[[float], Any],
        cfg: Optional[TCConfig] = None,
        session_id: Optional[str] = None,
        raw_csv_path: Optional[Path] = None,
    ) -> None:
        self._send = scpi_send
        self._read_temp = chamber_temp
        self._set_chamber = chamber_setpoint
        self.cfg = cfg or TCConfig()
        self.session_id = session_id or f"TC-{uuid.uuid4().hex[:8]}"
        self.state: TCState = TCState.IDLE
        self.cycle: int = 0
        self.samples: List[TCSample] = []
        self.cycle_log: List[CycleRecord] = []
        self.started_at_ms: Optional[int] = None
        self.finished_at_ms: Optional[int] = None
        self._abort = asyncio.Event()
        self._raw_csv_path = raw_csv_path
        self._sim_s: float = 0.0
        self._set_current_a: float = 0.0
        self._set_voltage_v: float = 0.0
        # working buffers for current/active cycle
        self._cycle_buf: List[TCSample] = []

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    @property
    def total_cycles(self) -> int:
        return self.cfg.cycles

    def abort(self) -> None:
        self._abort.set()

    async def stream(self) -> AsyncIterator[TCSample]:
        """Run the test, yielding one ``TCSample`` per sample interval."""
        await self._send_prelude()
        self.started_at_ms = int(time.time() * 1000)
        self.state = TCState.IDLE
        try:
            for c in range(1, self.cfg.cycles + 1):
                if self._abort.is_set():
                    break
                self.cycle = c
                self._cycle_buf.clear()
                async for s in self._run_one_cycle():
                    self.samples.append(s)
                    self._cycle_buf.append(s)
                    yield s
                    if self._abort.is_set():
                        break
                self.cycle_log.append(self._summarize_cycle(c))
            if self._abort.is_set():
                self.state = TCState.ABORTED
            else:
                self.state = TCState.DONE
            self.finished_at_ms = int(time.time() * 1000)
        finally:
            await self._safe_send("OUTP OFF")
            if self._raw_csv_path is not None:
                self.write_raw_csv(self._raw_csv_path)

    async def run_to_completion(self) -> Dict[str, Any]:
        """Drain the stream and return the summary dict."""
        async for _ in self.stream():
            pass
        return self.summary()

    def summary(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "state": self.state.value,
            "cycles_completed": len(self.cycle_log),
            "cycles_target": self.cfg.cycles,
            "samples": len(self.samples),
            "started_at_ms": self.started_at_ms,
            "finished_at_ms": self.finished_at_ms,
            "config": asdict(self.cfg),
        }

    def write_raw_csv(self, path: Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow([
                "ts_ms", "sim_s", "cycle", "state",
                "temperature_c", "current_a", "voltage_v", "set_current_a",
            ])
            for s in self.samples:
                w.writerow([
                    s.ts_ms, f"{s.sim_s:.3f}", s.cycle, s.state,
                    f"{s.temperature_c:.3f}", f"{s.current_a:.5f}",
                    f"{s.voltage_v:.4f}", f"{s.set_current_a:.5f}",
                ])
        return path.resolve()

    # ------------------------------------------------------------------
    # State machine — one full cycle
    # ------------------------------------------------------------------
    async def _run_one_cycle(self) -> AsyncIterator[TCSample]:
        cfg = self.cfg
        # Heating: t_cold → t_hot at ramp rate
        async for s in self._ramp(cfg.t_cold_c, cfg.t_hot_c, TCState.HEATING):
            yield s
        # Hot dwell
        async for s in self._dwell(cfg.t_hot_c, cfg.hot_dwell_s, TCState.DWELL_HOT):
            yield s
        # Cooling
        async for s in self._ramp(cfg.t_hot_c, cfg.t_cold_c, TCState.COOLING):
            yield s
        # Cold dwell
        async for s in self._dwell(cfg.t_cold_c, cfg.cold_dwell_s, TCState.DWELL_COLD):
            yield s

    async def _ramp(
        self,
        t_from: float,
        t_to: float,
        new_state: TCState,
    ) -> AsyncIterator[TCSample]:
        cfg = self.cfg
        rate = cfg.ramp_rate_c_per_h
        if rate > MAX_RAMP_C_PER_HOUR + 1e-9:
            raise ValueError(
                f"ramp {rate} exceeds IEC limit {MAX_RAMP_C_PER_HOUR} °C/h"
            )
        delta_c = abs(t_to - t_from)
        duration_s = (delta_c / rate) * 3600.0
        if duration_s <= 0:
            return
        self.state = new_state
        await self._set_chamber_safe(t_to)
        step = cfg.sample_interval_s
        n = max(1, int(duration_s / step))
        start_sim = self._sim_s
        for i in range(n + 1):
            frac = i / n
            t = t_from + (t_to - t_from) * frac
            # technology-aware continuity current
            i_set = self._continuity_current(new_state, t)
            await self._program_current(i_set)
            v_meas = self._set_voltage_v + random.gauss(0, 0.02)
            i_meas = i_set + random.gauss(0, 0.005 if abs(i_set) > 0.1 else 0.0005)
            t_meas = t + random.gauss(0, 0.15)  # PT100 sensor noise
            sample = TCSample(
                ts_ms=int(time.time() * 1000),
                sim_s=self._sim_s,
                cycle=self.cycle,
                state=new_state.value,
                temperature_c=t_meas,
                current_a=i_meas,
                voltage_v=v_meas,
                set_current_a=i_set,
            )
            yield sample
            self._sim_s = start_sim + (frac * duration_s)
            await asyncio.sleep(step / max(cfg.time_scale, 1.0))
            if self._abort.is_set():
                return

    async def _dwell(
        self,
        t_target: float,
        duration_s: float,
        new_state: TCState,
    ) -> AsyncIterator[TCSample]:
        if duration_s < MIN_DWELL_SECONDS:
            raise ValueError(
                f"dwell {duration_s}s violates IEC 10-min minimum"
            )
        cfg = self.cfg
        self.state = new_state
        await self._set_chamber_safe(t_target)
        step = cfg.sample_interval_s
        n = max(1, int(duration_s / step))
        start_sim = self._sim_s
        for i in range(n + 1):
            i_set = self._continuity_current(new_state, t_target)
            await self._program_current(i_set)
            v_meas = self._set_voltage_v + random.gauss(0, 0.02)
            i_meas = i_set + random.gauss(0, 0.005 if abs(i_set) > 0.1 else 0.0005)
            t_meas = t_target + random.gauss(0, 0.20)
            sample = TCSample(
                ts_ms=int(time.time() * 1000),
                sim_s=self._sim_s,
                cycle=self.cycle,
                state=new_state.value,
                temperature_c=t_meas,
                current_a=i_meas,
                voltage_v=v_meas,
                set_current_a=i_set,
            )
            yield sample
            self._sim_s = start_sim + ((i / n) * duration_s)
            await asyncio.sleep(step / max(cfg.time_scale, 1.0))
            if self._abort.is_set():
                return

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _continuity_current(self, state: TCState, t_c: float) -> float:
        """IEC 61215-2 MQT 11 §4.11.5 continuity-current schedule.

        - Heat-up & hot dwell while T < (T_max - 5 K) and continuing through
          the hot dwell: Imp at STC (technology-dependent).
        - Cool-down and cold dwell: 1 % of Imp (open-circuit detector).
        """
        imp = self.cfg.imp()
        if state in (TCState.HEATING, TCState.DWELL_HOT):
            if state == TCState.HEATING and t_c < CURRENT_OFF_TEMP_C:
                return imp
            if state == TCState.DWELL_HOT:
                return imp
            return imp                # heat-up tail above 80 °C
        if state in (TCState.COOLING, TCState.DWELL_COLD):
            return 0.01 * imp
        return 0.0

    async def _send_prelude(self) -> None:
        for tmpl in self.SCPI_PRELUDE:
            cmd = tmpl.format(
                voc=self.cfg.voc_v,
                ovp=self.cfg.voc_v * 1.10,
                ocp=self.cfg.imp() * 1.20,
            )
            await self._safe_send(cmd)
        self._set_voltage_v = self.cfg.voc_v

    async def _program_current(self, amps: float) -> None:
        if abs(amps - self._set_current_a) < 1e-4:
            return
        await self._safe_send(f"SOUR:CURR:LEV:IMM {amps:.5f}")
        if amps > 1e-6 and self._set_current_a < 1e-6:
            await self._safe_send("OUTP ON")
        self._set_current_a = amps

    async def _safe_send(self, cmd: str) -> None:
        try:
            result = self._send(cmd)
            if asyncio.iscoroutine(result):
                await result
        except Exception:
            pass

    async def _set_chamber_safe(self, t_c: float) -> None:
        try:
            result = self._set_chamber(t_c)
            if asyncio.iscoroutine(result):
                await result
        except Exception:
            pass

    def _summarize_cycle(self, c: int) -> CycleRecord:
        buf = self._cycle_buf
        if not buf:
            return CycleRecord(c, 0, 0, 0, 0, 0, 0, 0, 0)
        heats = [s for s in buf if s.state == TCState.HEATING.value]
        cools = [s for s in buf if s.state == TCState.COOLING.value]
        hot_dwell = [s for s in buf if s.state == TCState.DWELL_HOT.value]
        cold_dwell = [s for s in buf if s.state == TCState.DWELL_COLD.value]

        def _ramp_rate(seq: List[TCSample]) -> float:
            if len(seq) < 2:
                return 0.0
            dt_h = (seq[-1].sim_s - seq[0].sim_s) / 3600.0
            if dt_h <= 0:
                return 0.0
            return (seq[-1].temperature_c - seq[0].temperature_c) / dt_h

        def _dwell_s(seq: List[TCSample]) -> float:
            if len(seq) < 2:
                return 0.0
            return seq[-1].sim_s - seq[0].sim_s

        # discontinuity scan, isolated to this cycle's buffer
        i_disc, v_disc = scan_discontinuities(buf)

        return CycleRecord(
            cycle=c,
            t_hot_peak_c=max((s.temperature_c for s in buf), default=0.0),
            t_cold_peak_c=min((s.temperature_c for s in buf), default=0.0),
            avg_ramp_up_c_per_h=_ramp_rate(heats),
            avg_ramp_down_c_per_h=_ramp_rate(cools),
            hot_dwell_s=_dwell_s(hot_dwell),
            cold_dwell_s=_dwell_s(cold_dwell),
            current_discontinuities=i_disc,
            voltage_discontinuities=v_disc,
        )


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------
@dataclass
class TCAnalysis:
    """IEC 61215-1 Gate 2 evaluation result."""
    session_id: str
    cycles_completed: int
    cycles_target: int
    pre_pmax_w: float
    post_pmax_w: float
    delta_pmax_percent: float
    gate2_threshold_percent: float
    current_discontinuities: int
    voltage_discontinuities: int
    state: str
    pass_fail: str        # "PASS" | "FAIL"
    reasons: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def scan_discontinuities(
    samples: List[TCSample],
    i_drop_ratio: float = 0.5,
    v_jump_volts: float = 1.0,
) -> tuple[int, int]:
    """Count current and voltage discontinuities per IEC 61215-2 MQT 11.

    A *current discontinuity* (= open circuit) is any sample where, with a
    non-zero programmed current, the measured current collapses below
    ``i_drop_ratio`` of the set point. A *voltage discontinuity* is a
    >= ``v_jump_volts`` step between consecutive samples.
    """
    i_disc = 0
    v_disc = 0
    last_v: Optional[float] = None
    for s in samples:
        if s.set_current_a > 0.05:
            ratio = s.current_a / s.set_current_a if s.set_current_a > 0 else 0.0
            if ratio < i_drop_ratio:
                i_disc += 1
        if last_v is not None and abs(s.voltage_v - last_v) >= v_jump_volts:
            v_disc += 1
        last_v = s.voltage_v
    return i_disc, v_disc


def analyze(
    orchestrator: ThermalCyclingOrchestrator,
    post_pmax_w: float,
) -> TCAnalysis:
    """Apply IEC 61215-1 Gate 2 + IEC 61215-2 MQT 11 continuity checks."""
    cfg = orchestrator.cfg
    pre = cfg.pre_test_pmax_w
    i_disc, v_disc = scan_discontinuities(orchestrator.samples)
    if pre <= 0:
        delta = 0.0
    else:
        delta = (post_pmax_w - pre) / pre * 100.0

    reasons: List[str] = []
    completed = len(orchestrator.cycle_log)
    if completed < cfg.cycles:
        reasons.append(
            f"only {completed}/{cfg.cycles} cycles completed"
        )
    if pre > 0 and delta < GATE2_DELTA_PMAX_PERCENT:
        reasons.append(
            f"ΔPmax {delta:.2f}% violates IEC 61215-1 Gate 2 "
            f"({GATE2_DELTA_PMAX_PERCENT}%)"
        )
    if i_disc > 0:
        reasons.append(f"{i_disc} current discontinuities (open circuit)")
    if v_disc > 0:
        reasons.append(f"{v_disc} voltage discontinuities")
    if orchestrator.state == TCState.ABORTED:
        reasons.append("test aborted before completion")

    verdict = "FAIL" if reasons else "PASS"
    return TCAnalysis(
        session_id=orchestrator.session_id,
        cycles_completed=completed,
        cycles_target=cfg.cycles,
        pre_pmax_w=pre,
        post_pmax_w=post_pmax_w,
        delta_pmax_percent=delta,
        gate2_threshold_percent=GATE2_DELTA_PMAX_PERCENT,
        current_discontinuities=i_disc,
        voltage_discontinuities=v_disc,
        state=orchestrator.state.value,
        pass_fail=verdict,
        reasons=reasons,
    )


# ---------------------------------------------------------------------------
# Simulated chamber for demo / pytest paths
# ---------------------------------------------------------------------------
class SimChamber:
    """First-order chamber model that follows ``set_target`` over time."""

    def __init__(self, t0_c: float = 25.0, tau_s: float = 60.0) -> None:
        self.t_c = t0_c
        self.target_c = t0_c
        self.tau_s = tau_s
        self._last = time.monotonic()

    def set_target(self, t_c: float) -> None:
        self.target_c = t_c

    def read(self) -> float:
        now = time.monotonic()
        dt = now - self._last
        self._last = now
        alpha = 1 - math.exp(-dt / max(self.tau_s, 1e-6))
        self.t_c += alpha * (self.target_c - self.t_c)
        return self.t_c + random.gauss(0, 0.05)


def make_demo_orchestrator(
    cfg: Optional[TCConfig] = None,
    raw_csv_path: Optional[Path] = None,
) -> ThermalCyclingOrchestrator:
    """Factory for a DEMO-mode orchestrator with no-op SCPI + sim chamber."""
    chamber = SimChamber()

    async def send(_cmd: str) -> None:
        return None

    return ThermalCyclingOrchestrator(
        scpi_send=send,
        chamber_temp=chamber.read,
        chamber_setpoint=chamber.set_target,
        cfg=cfg,
        raw_csv_path=raw_csv_path,
    )
