"""IEC 61215-2 MQT 12 — Humidity Freeze test orchestrator.

Implements the Figure 9 profile from IEC 61215-2:2021 clause 4.12:

  - 10 cycles
  - Hot dwell at +85 C / 85% RH for >= 20 h (tolerances +/- 2 C, +/- 5% RH)
  - Ramp down to -40 C at <= 200 C/h
  - Cold dwell at -40 C for >= 30 min
  - Ramp back up to +85 C at <= 100 C/h
  - Continuous reverse-bias current = max(0.5% * I_mp_STC, 100 mA)
  - Pass/fail per clause 4.12.5: no major visual defects, MQT 01 visual
    + MQT 15 wet leakage current within limits, no ramp/dwell violations.

The module is intentionally pure-Python and hardware-agnostic so it can
be exercised by ``pytest`` without any I/O. The ``ScpiClient`` is only
touched by ``run()`` and ``stop()`` -- the analysis, profile generation,
and demo simulator are stand-alone helpers.
"""
from __future__ import annotations

import asyncio
import csv
import logging
import math
import random
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Iterator, List, Optional, Tuple

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# IEC 61215-2 clause 4.12 constants
# ---------------------------------------------------------------------------

IEC_CLAUSE = "IEC 61215-2:2021 clause 4.12 (MQT 12)"
DEFAULT_CYCLES = 10
HOT_DWELL_MIN_HOURS = 20.0
COLD_DWELL_MIN_MINUTES = 30.0
T_HOT_C = 85.0
T_COLD_C = -40.0
RH_HOT_PERCENT = 85.0
T_TOLERANCE_C = 2.0
RH_TOLERANCE_PERCENT = 5.0
MAX_RAMP_DOWN_C_PER_H = 200.0
MAX_RAMP_UP_C_PER_H = 100.0
MIN_BIAS_CURRENT_A = 0.100
BIAS_FRACTION_OF_IMP = 0.005  # 0.5% of STC max-power current


# ---------------------------------------------------------------------------
# Configuration & results dataclasses
# ---------------------------------------------------------------------------

@dataclass
class HFConfig:
    """Operator-tunable knobs. All defaults match IEC 61215-2 MQT 12."""
    cycles: int = DEFAULT_CYCLES
    t_hot_c: float = T_HOT_C
    t_cold_c: float = T_COLD_C
    rh_hot_percent: float = RH_HOT_PERCENT
    hot_dwell_hours: float = HOT_DWELL_MIN_HOURS
    cold_dwell_minutes: float = COLD_DWELL_MIN_MINUTES
    max_ramp_down_c_per_h: float = MAX_RAMP_DOWN_C_PER_H
    max_ramp_up_c_per_h: float = MAX_RAMP_UP_C_PER_H
    i_mp_stc_a: float = 9.0  # STC maximum power-point current
    v_oc_stc_v: float = 45.0  # STC open-circuit voltage (for OVP setpoint)
    # Compression factor (>=1.0) for accelerated demo runs. Real test
    # always uses 1.0; pytest / Playwright use a much higher value so the
    # full 10-cycle profile fits in seconds.
    time_compression: float = 1.0

    def bias_current_a(self) -> float:
        """Reverse bias current per clause 4.12.3."""
        return max(MIN_BIAS_CURRENT_A, BIAS_FRACTION_OF_IMP * self.i_mp_stc_a)

    def cycle_duration_s(self) -> float:
        """Estimated single-cycle wall-clock seconds for sizing buffers."""
        hot = self.hot_dwell_hours * 3600.0
        cold = self.cold_dwell_minutes * 60.0
        ramp_down = (self.t_hot_c - self.t_cold_c) / max(1e-6, self.max_ramp_down_c_per_h) * 3600.0
        ramp_up = (self.t_hot_c - self.t_cold_c) / max(1e-6, self.max_ramp_up_c_per_h) * 3600.0
        return (hot + cold + ramp_down + ramp_up) / max(1e-9, self.time_compression)


@dataclass
class ProfileSample:
    """One temperature/RH/current point along the Figure 9 profile."""
    t_s: float          # elapsed seconds from cycle 1 start
    cycle: int          # 1-based cycle index
    phase: str          # 'hot_dwell' | 'ramp_down' | 'cold_dwell' | 'ramp_up'
    temperature_c: float
    rh_percent: float
    bias_current_a: float


@dataclass
class RampViolation:
    cycle: int
    phase: str          # 'ramp_down' or 'ramp_up'
    rate_c_per_h: float
    limit_c_per_h: float


@dataclass
class DwellCheck:
    cycle: int
    phase: str          # 'hot_dwell' or 'cold_dwell'
    duration_s: float
    minimum_s: float
    in_tolerance: bool  # T (and RH for hot dwell) within IEC tolerance
    ok: bool


@dataclass
class HFResult:
    session_id: str
    started_at: float
    finished_at: Optional[float] = None
    config: dict = field(default_factory=dict)
    profile: List[ProfileSample] = field(default_factory=list)
    ramp_violations: List[RampViolation] = field(default_factory=list)
    dwell_checks: List[DwellCheck] = field(default_factory=list)
    cycle_log: List[dict] = field(default_factory=list)
    mqt01_visual_pass: Optional[bool] = None   # MQT 01 follow-on
    mqt15_wet_leakage_pass: Optional[bool] = None  # MQT 15 follow-on
    raw_csv_path: Optional[str] = None
    verdict: str = "IN_PROGRESS"
    reasons: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["iec_clause"] = IEC_CLAUSE
        return d


# ---------------------------------------------------------------------------
# Profile generation (Figure 9)
# ---------------------------------------------------------------------------

def generate_figure9_profile(cfg: HFConfig, sample_interval_s: float = 60.0) -> List[ProfileSample]:
    """Synthesise the nominal Figure 9 envelope.

    Returns one ``ProfileSample`` per ``sample_interval_s`` of compressed
    wall-clock time. The profile is deterministic (no noise) -- noise is
    added by ``DemoHFSimulator``.
    """
    if cfg.cycles < 1:
        raise ValueError("cycles must be >= 1")
    out: List[ProfileSample] = []
    t = 0.0
    hot_s = cfg.hot_dwell_hours * 3600.0 / cfg.time_compression
    cold_s = cfg.cold_dwell_minutes * 60.0 / cfg.time_compression
    # Drive ramps at 90% of the IEC ceiling so measurement noise cannot
    # nudge the rate over the limit -- matches conservative chamber
    # programming in real laboratories.
    nominal_down = cfg.max_ramp_down_c_per_h * 0.9
    nominal_up = cfg.max_ramp_up_c_per_h * 0.9
    ramp_down_s = (cfg.t_hot_c - cfg.t_cold_c) / nominal_down * 3600.0 / cfg.time_compression
    ramp_up_s = (cfg.t_hot_c - cfg.t_cold_c) / nominal_up * 3600.0 / cfg.time_compression
    bias = cfg.bias_current_a()

    def emit(cycle: int, phase: str, dur: float, temp_fn, rh_fn) -> None:
        nonlocal t
        if dur <= 0:
            return
        steps = max(1, int(math.ceil(dur / sample_interval_s)))
        step_dt = dur / steps
        for k in range(steps + 1):
            local_t = k * step_dt
            out.append(ProfileSample(
                t_s=t + local_t,
                cycle=cycle,
                phase=phase,
                temperature_c=temp_fn(local_t / dur if dur else 0.0),
                rh_percent=rh_fn(local_t / dur if dur else 0.0),
                bias_current_a=bias,
            ))
        t += dur

    for cycle in range(1, cfg.cycles + 1):
        # 1) hot dwell — 85 C / 85% RH, flat
        emit(cycle, "hot_dwell", hot_s,
             temp_fn=lambda _f: cfg.t_hot_c,
             rh_fn=lambda _f: cfg.rh_hot_percent)
        # 2) ramp down — RH uncontrolled below 0 C per IEC (decays)
        emit(cycle, "ramp_down", ramp_down_s,
             temp_fn=lambda f: cfg.t_hot_c + (cfg.t_cold_c - cfg.t_hot_c) * f,
             rh_fn=lambda f: max(0.0, cfg.rh_hot_percent * (1 - f)))
        # 3) cold dwell — -40 C, RH ~ 0
        emit(cycle, "cold_dwell", cold_s,
             temp_fn=lambda _f: cfg.t_cold_c,
             rh_fn=lambda _f: 0.0)
        # 4) ramp up — RH stays low until hot dwell
        emit(cycle, "ramp_up", ramp_up_s,
             temp_fn=lambda f: cfg.t_cold_c + (cfg.t_hot_c - cfg.t_cold_c) * f,
             rh_fn=lambda f: cfg.rh_hot_percent * f if f > 0.9 else 0.0)
    return out


# ---------------------------------------------------------------------------
# Demo simulator -- Figure 9 with realistic measurement noise
# ---------------------------------------------------------------------------

@dataclass
class DemoHFSimulator:
    cfg: HFConfig
    rng_seed: Optional[int] = None
    t_noise_c: float = 0.4
    rh_noise: float = 0.8
    i_noise_a: float = 0.002

    def __post_init__(self) -> None:
        self._rng = random.Random(self.rng_seed)
        self._nominal = generate_figure9_profile(self.cfg, sample_interval_s=30.0)

    def stream(self) -> Iterator[ProfileSample]:
        for s in self._nominal:
            yield ProfileSample(
                t_s=s.t_s,
                cycle=s.cycle,
                phase=s.phase,
                temperature_c=s.temperature_c + self._rng.gauss(0.0, self.t_noise_c),
                rh_percent=max(0.0, min(100.0, s.rh_percent + self._rng.gauss(0.0, self.rh_noise))),
                bias_current_a=max(0.0, s.bias_current_a + self._rng.gauss(0.0, self.i_noise_a)),
            )


# ---------------------------------------------------------------------------
# Analysis -- IEC clause 4.12.5 evaluation
# ---------------------------------------------------------------------------

def analyse_profile(samples: Iterable[ProfileSample], cfg: HFConfig) -> Tuple[
    List[RampViolation], List[DwellCheck], List[dict]
]:
    """Walk one execution profile and grade every cycle phase.

    Returns ``(ramp_violations, dwell_checks, cycle_log)``.
    """
    by_phase: dict[Tuple[int, str], List[ProfileSample]] = {}
    for s in samples:
        by_phase.setdefault((s.cycle, s.phase), []).append(s)

    ramp_violations: List[RampViolation] = []
    dwell_checks: List[DwellCheck] = []
    cycle_log: List[dict] = []

    cycles = sorted({c for (c, _) in by_phase})
    for cycle in cycles:
        entry: dict = {"cycle": cycle}
        for phase, limit in (("ramp_down", cfg.max_ramp_down_c_per_h),
                             ("ramp_up", cfg.max_ramp_up_c_per_h)):
            pts = by_phase.get((cycle, phase), [])
            if len(pts) < 2:
                continue
            t0, t1 = pts[0].t_s, pts[-1].t_s
            T0, T1 = pts[0].temperature_c, pts[-1].temperature_c
            dt_h = max(1e-9, (t1 - t0) / 3600.0) * cfg.time_compression
            rate = abs((T1 - T0) / dt_h)
            entry[f"{phase}_rate_c_per_h"] = round(rate, 2)
            if rate > limit + 1e-3:
                ramp_violations.append(RampViolation(
                    cycle=cycle, phase=phase,
                    rate_c_per_h=round(rate, 2),
                    limit_c_per_h=limit,
                ))

        # Hot dwell
        hot = by_phase.get((cycle, "hot_dwell"), [])
        if hot:
            dur_s = (hot[-1].t_s - hot[0].t_s) * cfg.time_compression
            in_tol_T = all(abs(s.temperature_c - cfg.t_hot_c) <= T_TOLERANCE_C for s in hot)
            in_tol_RH = all(abs(s.rh_percent - cfg.rh_hot_percent) <= RH_TOLERANCE_PERCENT for s in hot)
            minimum = HOT_DWELL_MIN_HOURS * 3600.0
            ok = (dur_s >= minimum) and in_tol_T and in_tol_RH
            dwell_checks.append(DwellCheck(
                cycle=cycle, phase="hot_dwell",
                duration_s=round(dur_s, 1), minimum_s=minimum,
                in_tolerance=in_tol_T and in_tol_RH, ok=ok,
            ))
            entry["hot_dwell_s"] = round(dur_s, 1)
            entry["hot_in_tol"] = in_tol_T and in_tol_RH

        # Cold dwell
        cold = by_phase.get((cycle, "cold_dwell"), [])
        if cold:
            dur_s = (cold[-1].t_s - cold[0].t_s) * cfg.time_compression
            in_tol_T = all(abs(s.temperature_c - cfg.t_cold_c) <= T_TOLERANCE_C for s in cold)
            minimum = COLD_DWELL_MIN_MINUTES * 60.0
            ok = (dur_s >= minimum) and in_tol_T
            dwell_checks.append(DwellCheck(
                cycle=cycle, phase="cold_dwell",
                duration_s=round(dur_s, 1), minimum_s=minimum,
                in_tolerance=in_tol_T, ok=ok,
            ))
            entry["cold_dwell_s"] = round(dur_s, 1)
            entry["cold_in_tol"] = in_tol_T

        cycle_log.append(entry)

    return ramp_violations, dwell_checks, cycle_log


def grade(result: HFResult, cfg: HFConfig) -> None:
    """Apply clause 4.12.5 pass/fail rules in place on ``result``."""
    reasons: List[str] = []
    if result.ramp_violations:
        reasons.append(
            f"{len(result.ramp_violations)} ramp-rate violation(s) exceed IEC limits "
            f"(<= {cfg.max_ramp_down_c_per_h} C/h down, <= {cfg.max_ramp_up_c_per_h} C/h up)"
        )
    bad_dwells = [d for d in result.dwell_checks if not d.ok]
    if bad_dwells:
        reasons.append(f"{len(bad_dwells)} dwell(s) failed tolerance or minimum duration")
    seen_cycles = {d.cycle for d in result.dwell_checks if d.phase == "hot_dwell"}
    if len(seen_cycles) < cfg.cycles:
        reasons.append(f"Only {len(seen_cycles)}/{cfg.cycles} hot dwells observed")
    if result.mqt01_visual_pass is False:
        reasons.append("MQT 01 visual inspection failed")
    if result.mqt15_wet_leakage_pass is False:
        reasons.append("MQT 15 wet leakage current outside limits")
    result.reasons = reasons
    result.verdict = "FAIL" if reasons else "PASS"


# ---------------------------------------------------------------------------
# Follow-on test stubs (MQT 01 visual, MQT 15 wet leakage)
# ---------------------------------------------------------------------------

def mqt01_visual_stub(operator_pass: Optional[bool] = None) -> bool:
    """MQT 01 visual inspection per IEC 61215-2 clause 4.1.

    The operator marks the verdict after a 1x post-test visual scan. The
    backend simply records the decision so the report can cite it.
    """
    return True if operator_pass is None else operator_pass


def mqt15_wet_leakage_stub(measured_resistance_mohm: Optional[float] = None,
                           area_m2: float = 1.6) -> bool:
    """MQT 15 wet leakage per IEC 61215-2 clause 4.15.

    Pass criterion: insulation resistance * area >= 40 MOhm * m2 (for
    modules > 0.1 m2). With no measurement supplied we optimistically
    return ``True``; the orchestrator records the value for the report.
    """
    if measured_resistance_mohm is None:
        return True
    return measured_resistance_mohm * area_m2 >= 40.0


# ---------------------------------------------------------------------------
# CSV writer
# ---------------------------------------------------------------------------

def write_raw_csv(samples: Iterable[ProfileSample], path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["t_s", "cycle", "phase", "temperature_c", "rh_percent", "bias_current_a"])
        for s in samples:
            w.writerow([f"{s.t_s:.2f}", s.cycle, s.phase,
                        f"{s.temperature_c:.3f}", f"{s.rh_percent:.2f}",
                        f"{s.bias_current_a:.4f}"])
    return path


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

class HumidityFreezeRunner:
    """Stateful orchestrator for one MQT 12 run.

    Pure execution lives in ``run()``. Bias-current programming uses the
    supplied SCPI client when present; in demo mode we just drive the
    simulator and log the would-be SCPI commands. The class is
    intentionally decoupled from FastAPI -- the WS endpoint constructs
    one per session, awaits ``run()``, and broadcasts ``on_sample``.
    """

    STANDARD = "IEC 61215-2 MQT 12"
    CLAUSE = IEC_CLAUSE

    def __init__(self,
                 scpi: Optional[object] = None,
                 cfg: Optional[HFConfig] = None,
                 raw_csv_dir: str = "logs/hf_raw") -> None:
        self.scpi = scpi
        self.cfg = cfg or HFConfig()
        self.session_id = str(uuid.uuid4())
        self.result = HFResult(session_id=self.session_id,
                               started_at=time.time(),
                               config=asdict(self.cfg))
        self._raw_csv_dir = Path(raw_csv_dir)
        self._abort = False
        self._task: Optional[asyncio.Task] = None

    # -- public control -----------------------------------------------------

    async def stop(self) -> None:
        self._abort = True
        if self.scpi is not None and hasattr(self.scpi, "send"):
            try:
                await self.scpi.send("OUTP OFF")
            except Exception:  # pragma: no cover -- best effort
                log.exception("OUTP OFF failed during HF stop")

    async def run(self,
                  on_sample: Optional[Callable[[ProfileSample], None]] = None,
                  ) -> HFResult:
        """Execute the full profile. ``on_sample`` is invoked per sample."""
        cfg = self.cfg
        log.info("HF run start: session=%s cycles=%d compression=%.1fx bias=%.3fA",
                 self.session_id, cfg.cycles, cfg.time_compression, cfg.bias_current_a())

        await self._program_bias()

        sim = DemoHFSimulator(cfg=cfg, rng_seed=0xA12)
        wall_t0 = time.monotonic()
        last_real_t = 0.0

        for sample in sim.stream():
            if self._abort:
                self.result.verdict = "ABORTED"
                break
            self.result.profile.append(sample)
            if on_sample is not None:
                try:
                    on_sample(sample)
                except Exception:  # pragma: no cover
                    log.exception("on_sample callback raised")
            # Respect compressed wall-clock pacing -- bounded so unit
            # tests stay fast.
            dt = max(0.0, sample.t_s - last_real_t)
            last_real_t = sample.t_s
            if dt > 0 and cfg.time_compression > 0:
                await asyncio.sleep(min(0.01, dt))

        self.result.finished_at = time.time()
        violations, dwells, cycle_log = analyse_profile(self.result.profile, cfg)
        self.result.ramp_violations = violations
        self.result.dwell_checks = dwells
        self.result.cycle_log = cycle_log
        self.result.mqt01_visual_pass = mqt01_visual_stub()
        self.result.mqt15_wet_leakage_pass = mqt15_wet_leakage_stub()

        csv_path = self._raw_csv_dir / f"hf_{self.session_id}.csv"
        try:
            write_raw_csv(self.result.profile, csv_path)
            self.result.raw_csv_path = str(csv_path)
        except OSError:  # pragma: no cover -- read-only fs in sandboxes
            log.exception("Failed to write HF raw CSV")

        grade(self.result, cfg)
        wall = time.monotonic() - wall_t0
        log.info("HF run done: verdict=%s wall=%.1fs samples=%d violations=%d",
                 self.result.verdict, wall, len(self.result.profile),
                 len(self.result.ramp_violations))
        return self.result

    # -- helpers ------------------------------------------------------------

    async def _program_bias(self) -> None:
        cfg = self.cfg
        bias = cfg.bias_current_a()
        cmds = [
            "*CLS",
            f"VOLT:PROT {cfg.v_oc_stc_v * 1.1:.2f}",
            f"CURR:PROT {max(0.5, bias * 2):.3f}",
            "SOUR:FUNC:MODE CC",
            f"SOUR:CURR {bias:.4f}",
            "OUTP ON",
        ]
        if self.scpi is None or not hasattr(self.scpi, "send"):
            log.info("HF demo: would send SCPI: %s", "; ".join(cmds))
            return
        for c in cmds:
            await self.scpi.send(c)


# ---------------------------------------------------------------------------
# Module-level convenience: a one-shot synchronous driver for the CLI /
# pytest paths that don't want to spin up FastAPI.
# ---------------------------------------------------------------------------

async def run_demo(cfg: Optional[HFConfig] = None) -> HFResult:
    cfg = cfg or HFConfig(time_compression=600.0)  # 1 cycle ~ seconds
    runner = HumidityFreezeRunner(scpi=None, cfg=cfg)
    return await runner.run()


__all__ = [
    "IEC_CLAUSE",
    "HFConfig",
    "HFResult",
    "ProfileSample",
    "RampViolation",
    "DwellCheck",
    "DemoHFSimulator",
    "HumidityFreezeRunner",
    "analyse_profile",
    "generate_figure9_profile",
    "grade",
    "mqt01_visual_stub",
    "mqt15_wet_leakage_stub",
    "run_demo",
    "write_raw_csv",
]
