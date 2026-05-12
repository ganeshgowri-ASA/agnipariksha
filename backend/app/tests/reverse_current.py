"""Reverse Current Overload orchestrator — IEC 61730-2 MST 26.

This module owns a full RCO run end-to-end:

  * Sets the ITECH PV6000 to source 1.35 * Isc_STC in the *reverse*
    direction across the device under test, for up to 2 hours, while
    the ambient is held at 30 +/- 5 C (operator interlock).

  * Streams telemetry samples (current, voltage, module-surface
    temperatures, junction-box temperature) at a fixed cadence to
    every registered listener (websocket fan-out, CSV writer, analyser).

  * Aborts on any of:
        - any surface or junction-box T > ``DEFAULT_ABORT_T_C`` (200 C)
        - arcing event reported by the hardware OR simulator
        - operator stop / pause-then-stop
        - voltage clamp breach (reverse V exceeds operator-supplied
          ``voltage_clamp_v``)

  * Runs analysis after the test completes (or aborts), evaluates
    pass/fail against MST 26, and lays out a folder containing:
        - raw_samples.csv         — every sample
        - summary.json            — analysis output + IEC references
        - hotspot_map.json        — placeholder grid for thermal-cam fusion

The class is intentionally hardware-agnostic: it accepts an injected
``sampler`` callable so the simulator (see :class:`DemoSimulator`) and
the live SCPI client can both drive it. The orchestrator never talks
to the SCPI socket directly; the WebSocket layer composes the two.

IEC references used in the report:
    - IEC 61730-2 MST 26 (Reverse Current Overload)
    - IEC 61730-2 MST 01 (visual inspection, post-test)
    - IEC 61730-2 MST 15 (wet leakage / dielectric, post-test)
    - IEC 61215-2 MQT 01 (visual inspection, post-test cross-ref)
    - IEC 61215-2 MQT 15 (wet leakage, post-test cross-ref)
"""
from __future__ import annotations

import asyncio
import csv
import json
import math
import random
import time
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import (
    Awaitable,
    Callable,
    Iterable,
    List,
    Optional,
    Sequence,
)


# ---------------------------------------------------------------------------
# Constants — IEC 61730-2 MST 26
# ---------------------------------------------------------------------------
FUSE_MULTIPLIER: float = 1.35
DEFAULT_DURATION_S: int = 2 * 60 * 60          # 2 hours
DEFAULT_SAMPLE_INTERVAL_S: float = 1.0
DEFAULT_AMBIENT_TARGET_C: float = 30.0
DEFAULT_AMBIENT_TOLERANCE_C: float = 5.0       # +/- 5 C operator interlock
DEFAULT_ABORT_T_C: float = 200.0               # MST 26 abort threshold
DEFAULT_VOLTAGE_CLAMP_V: float = 30.0          # safety clamp on reverse V
ARC_CURRENT_FLOOR_A: float = 0.05              # below this in <2 s -> arc/open

STANDARD_ID: str = "IEC 61730-2 MST 26"
POST_TEST_STANDARDS: tuple[str, ...] = (
    "IEC 61730-2 MST 01",
    "IEC 61730-2 MST 15",
    "IEC 61215-2 MQT 01",
    "IEC 61215-2 MQT 15",
)


class AbortReason(str, Enum):
    NONE = "none"
    OVER_TEMPERATURE = "over_temperature"
    ARC_DETECTED = "arc_detected"
    VOLTAGE_CLAMP = "voltage_clamp"
    AMBIENT_OUT_OF_RANGE = "ambient_out_of_range"
    OPERATOR_STOP = "operator_stop"
    HARDWARE_FAULT = "hardware_fault"
    COMPLETED = "completed"


@dataclass(frozen=True)
class ReverseCurrentParams:
    """Operator-supplied parameters for a single RCO run."""

    isc_stc_a: float                                   # nameplate Isc @ STC
    duration_s: int = DEFAULT_DURATION_S
    sample_interval_s: float = DEFAULT_SAMPLE_INTERVAL_S
    ambient_target_c: float = DEFAULT_AMBIENT_TARGET_C
    ambient_tolerance_c: float = DEFAULT_AMBIENT_TOLERANCE_C
    abort_temperature_c: float = DEFAULT_ABORT_T_C
    voltage_clamp_v: float = DEFAULT_VOLTAGE_CLAMP_V
    fuse_multiplier: float = FUSE_MULTIPLIER
    hotspot_enabled: bool = False                      # demo flag
    hotspot_after_s: float = 600.0                     # demo only
    operator: str = "operator"
    module_serial: str = ""

    @property
    def test_current_a(self) -> float:
        """Reverse current magnitude — 1.35 * Isc_STC."""
        return round(self.isc_stc_a * self.fuse_multiplier, 4)

    def validate(self) -> None:
        if self.isc_stc_a <= 0:
            raise ValueError("isc_stc_a must be > 0")
        if self.duration_s <= 0:
            raise ValueError("duration_s must be > 0")
        if self.sample_interval_s <= 0:
            raise ValueError("sample_interval_s must be > 0")
        if self.abort_temperature_c <= self.ambient_target_c:
            raise ValueError("abort_temperature_c must exceed ambient_target_c")
        if self.voltage_clamp_v <= 0:
            raise ValueError("voltage_clamp_v must be > 0")
        if self.ambient_tolerance_c < 0:
            raise ValueError("ambient_tolerance_c must be >= 0")


@dataclass
class Sample:
    """A single telemetry tick captured by the orchestrator.

    Temperatures are always negative-free positive Celsius. Current is
    reported as a *magnitude*; the orchestrator knows the polarity is
    reverse and the analyser annotates it.
    """

    t_s: float                  # seconds since session start
    current_a: float            # reverse current magnitude
    voltage_v: float            # measured voltage across DUT
    t_surface_c: float          # primary (mandatory) surface thermocouple
    t_jbox_c: float             # junction-box surface
    t_ambient_c: float          # chamber / lab ambient
    t_surface_grid_c: List[float] = field(default_factory=list)  # optional thermal cam pixels
    arc_flag: bool = False      # hardware-reported arc event
    timestamp_ms: int = 0       # wall clock when sample was captured

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ReverseCurrentResult:
    session_id: str
    started_at_ms: int
    ended_at_ms: int
    params: dict
    sample_count: int
    duration_s: float
    abort_reason: AbortReason
    passed: bool
    analysis: dict
    csv_path: Optional[str]
    summary_path: Optional[str]
    hotspot_map_path: Optional[str]

    def to_dict(self) -> dict:
        d = asdict(self)
        d["abort_reason"] = self.abort_reason.value
        return d


# ---------------------------------------------------------------------------
# Sampler protocol + demo simulator
# ---------------------------------------------------------------------------
Sampler = Callable[[float], Awaitable[Sample]]


class DemoSimulator:
    """Generates physically plausible RCO traces for demo / CI.

    Behaviour:
      * Current ramps from 0 to ``params.test_current_a`` over ~3 s,
        then holds with +/- 0.5% noise.
      * Voltage drops linearly from clamp to ~1.0 V as the DUT shunts.
      * Module surface T rises asymptotically toward an equilibrium
        determined by the ohmic dissipation (I^2 * R_diss); J-box runs
        ~10 C hotter than surface.
      * If ``hotspot_enabled`` is set, a localised pixel in the surface
        grid diverges starting at ``hotspot_after_s`` and crosses the
        200 C abort threshold around ``hotspot_after_s + 600 s``.
      * ~1 in 100 000 chance of an arc flag per sample to exercise the
        arc-abort branch; deterministic via the supplied ``rng``.

    The simulator is intentionally pure — it owns its own clock view
    via the ``t_s`` argument, so tests can step it deterministically.
    """

    def __init__(
        self,
        params: ReverseCurrentParams,
        rng: Optional[random.Random] = None,
        r_dissipation_ohm: float = 0.25,
        force_arc_at_s: Optional[float] = None,
    ) -> None:
        self.params = params
        self.rng = rng or random.Random(0xA6E1)
        self.r_dissipation_ohm = r_dissipation_ohm
        self.force_arc_at_s = force_arc_at_s
        self._grid_pixels = 16  # 4x4 thermal cam stand-in
        self._hotspot_idx = self.rng.randrange(self._grid_pixels)

    async def __call__(self, t_s: float) -> Sample:
        p = self.params
        # Current: 3 s ramp then steady with ~0.5% Gaussian noise.
        ramp = min(1.0, t_s / 3.0)
        i = p.test_current_a * ramp
        i += i * self.rng.gauss(0.0, 0.005)
        # Voltage: starts near clamp, settles to a small forward-drop value.
        v = max(1.0, p.voltage_clamp_v * math.exp(-t_s / 30.0))
        v += self.rng.gauss(0.0, 0.02)
        # Surface T: asymptotic rise toward equilibrium.
        p_diss = (i ** 2) * self.r_dissipation_ohm
        t_eq = p.ambient_target_c + p_diss * 1.2  # K/W simplified
        tau = 240.0
        t_surface = p.ambient_target_c + (t_eq - p.ambient_target_c) * (1.0 - math.exp(-t_s / tau))
        t_surface += self.rng.gauss(0.0, 0.3)
        # J-box runs hotter because of the cable termination.
        t_jbox = t_surface + 8.0 + self.rng.gauss(0.0, 0.4)
        # Ambient drifts +/- 1.5 C around the operator target.
        t_amb = p.ambient_target_c + self.rng.gauss(0.0, 0.6)

        # Thermal grid: every pixel near surface T, plus hotspot if armed.
        grid = [t_surface + self.rng.gauss(0.0, 0.5) for _ in range(self._grid_pixels)]
        if p.hotspot_enabled and t_s >= p.hotspot_after_s:
            elapsed_in_hot = t_s - p.hotspot_after_s
            bump = min(220.0, elapsed_in_hot * 0.35)  # ~210 C after 10 min
            grid[self._hotspot_idx] = t_surface + bump
            # Bleed hotspot into the primary thermocouple once it's severe.
            if grid[self._hotspot_idx] > 180.0:
                t_surface = max(t_surface, grid[self._hotspot_idx] - 5.0)

        # Arc event: either operator-forced or rare random.
        arc = False
        if self.force_arc_at_s is not None and t_s >= self.force_arc_at_s:
            arc = True
            i = ARC_CURRENT_FLOOR_A * 0.5  # current collapses
        elif self.rng.random() < 1e-5:
            arc = True

        return Sample(
            t_s=t_s,
            current_a=abs(i),
            voltage_v=v,
            t_surface_c=t_surface,
            t_jbox_c=t_jbox,
            t_ambient_c=t_amb,
            t_surface_grid_c=grid,
            arc_flag=arc,
            timestamp_ms=int(time.time() * 1000),
        )


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------
def analyse(
    samples: Sequence[Sample],
    params: ReverseCurrentParams,
    abort_reason: AbortReason,
) -> dict:
    """Compute pass/fail + MQT01/15 stubs from a finished run.

    Pass criteria (per MST 26 §10.13 + manufacturer interlock):
      * No abort triggered by over-T / arc / voltage clamp
      * Peak surface T stayed under ``params.abort_temperature_c``
      * Ambient remained within +/- ``params.ambient_tolerance_c``
      * Test ran for at least 95% of the requested duration
      * No hotspot pixel exceeded the abort threshold

    MQT 01 / MQT 15 are placeholder stubs flagged "deferred — operator
    measurement required" since they need post-test physical access to
    the module and a dielectric/wet-leakage rig.
    """
    if not samples:
        return _empty_analysis(params, abort_reason)

    duration_s = samples[-1].t_s
    sampled_pct = duration_s / params.duration_s if params.duration_s else 0.0

    surface_temps = [s.t_surface_c for s in samples]
    jbox_temps = [s.t_jbox_c for s in samples]
    ambient_temps = [s.t_ambient_c for s in samples]
    currents = [s.current_a for s in samples]
    voltages = [s.voltage_v for s in samples]

    peak_surface = max(surface_temps)
    peak_jbox = max(jbox_temps)
    peak_ambient = max(ambient_temps)
    min_ambient = min(ambient_temps)

    # Hotspot: any pixel exceeding abort_temperature - 20 (warning zone) or threshold.
    hotspot_events: list[dict] = []
    warning_floor = params.abort_temperature_c - 20.0
    for s in samples:
        if not s.t_surface_grid_c:
            continue
        peak_pixel = max(s.t_surface_grid_c)
        if peak_pixel >= warning_floor:
            pixel_idx = s.t_surface_grid_c.index(peak_pixel)
            hotspot_events.append({
                "t_s": s.t_s,
                "pixel": pixel_idx,
                "temperature_c": round(peak_pixel, 2),
                "exceeds_abort": peak_pixel >= params.abort_temperature_c,
            })

    ambient_in_band = (
        peak_ambient <= params.ambient_target_c + params.ambient_tolerance_c
        and min_ambient >= params.ambient_target_c - params.ambient_tolerance_c
    )

    # Pass/fail
    failure_reasons: list[str] = []
    if abort_reason not in (AbortReason.COMPLETED, AbortReason.NONE):
        failure_reasons.append(f"aborted:{abort_reason.value}")
    if peak_surface >= params.abort_temperature_c:
        failure_reasons.append("peak_surface_over_threshold")
    if peak_jbox >= params.abort_temperature_c:
        failure_reasons.append("peak_jbox_over_threshold")
    if not ambient_in_band:
        failure_reasons.append("ambient_out_of_band")
    if sampled_pct < 0.95 and abort_reason == AbortReason.COMPLETED:
        failure_reasons.append("short_duration")
    if any(e["exceeds_abort"] for e in hotspot_events):
        failure_reasons.append("hotspot_over_threshold")

    passed = not failure_reasons

    # Time-temperature profile: downsampled bins for the report.
    profile = _time_temperature_profile(samples, bins=60)

    return {
        "standard": STANDARD_ID,
        "clauses": [
            "IEC 61730-2 §10.13 MST 26 — Reverse current overload",
            "IEC 61730-2 §10.1 MST 01 — Visual inspection (post-test)",
            "IEC 61730-2 §10.4 MST 15 — Wet leakage (post-test)",
        ],
        "test_current_a": params.test_current_a,
        "duration_s": round(duration_s, 2),
        "duration_pct_of_target": round(sampled_pct * 100.0, 2),
        "sample_count": len(samples),
        "peak_current_a": round(max(currents), 4),
        "min_voltage_v": round(min(voltages), 4),
        "peak_voltage_v": round(max(voltages), 4),
        "peak_surface_temperature_c": round(peak_surface, 2),
        "peak_jbox_temperature_c": round(peak_jbox, 2),
        "ambient_min_c": round(min_ambient, 2),
        "ambient_max_c": round(peak_ambient, 2),
        "ambient_in_band": ambient_in_band,
        "hotspot_event_count": len(hotspot_events),
        "hotspot_events": hotspot_events[:50],  # cap report size
        "time_temperature_profile": profile,
        "post_test_stubs": {
            "MQT_01_visual_inspection": {
                "status": "deferred",
                "description": (
                    "Operator must perform IEC 61215-2 MQT 01 visual "
                    "inspection within 1 h of test completion; record "
                    "delamination, browning, cracks."
                ),
            },
            "MQT_15_wet_leakage": {
                "status": "deferred",
                "description": (
                    "Operator must perform IEC 61215-2 MQT 15 wet "
                    "leakage at 500 V DC; insulation resistance "
                    ">= 40 MΩ·m² required."
                ),
            },
        },
        "failure_reasons": failure_reasons,
        "passed": passed,
        "verdict": "PASS" if passed else "FAIL",
    }


def _empty_analysis(params: ReverseCurrentParams, abort: AbortReason) -> dict:
    return {
        "standard": STANDARD_ID,
        "clauses": [
            "IEC 61730-2 §10.13 MST 26 — Reverse current overload",
        ],
        "test_current_a": params.test_current_a,
        "duration_s": 0.0,
        "duration_pct_of_target": 0.0,
        "sample_count": 0,
        "peak_current_a": 0.0,
        "min_voltage_v": 0.0,
        "peak_voltage_v": 0.0,
        "peak_surface_temperature_c": 0.0,
        "peak_jbox_temperature_c": 0.0,
        "ambient_min_c": 0.0,
        "ambient_max_c": 0.0,
        "ambient_in_band": False,
        "hotspot_event_count": 0,
        "hotspot_events": [],
        "time_temperature_profile": [],
        "post_test_stubs": {},
        "failure_reasons": ["no_samples"],
        "passed": False,
        "verdict": "FAIL",
    }


def _time_temperature_profile(samples: Sequence[Sample], bins: int = 60) -> list[dict]:
    if not samples:
        return []
    total = samples[-1].t_s
    if total <= 0:
        return []
    width = total / bins
    out: list[dict] = []
    j = 0
    for b in range(bins):
        edge = (b + 1) * width
        chunk_surface: list[float] = []
        chunk_jbox: list[float] = []
        chunk_ambient: list[float] = []
        while j < len(samples) and samples[j].t_s <= edge:
            chunk_surface.append(samples[j].t_surface_c)
            chunk_jbox.append(samples[j].t_jbox_c)
            chunk_ambient.append(samples[j].t_ambient_c)
            j += 1
        if chunk_surface:
            out.append({
                "t_s": round(edge, 2),
                "t_surface_c": round(sum(chunk_surface) / len(chunk_surface), 2),
                "t_jbox_c": round(sum(chunk_jbox) / len(chunk_jbox), 2),
                "t_ambient_c": round(sum(chunk_ambient) / len(chunk_ambient), 2),
            })
    return out


# ---------------------------------------------------------------------------
# Report packaging
# ---------------------------------------------------------------------------
def write_report(
    out_dir: Path,
    session_id: str,
    params: ReverseCurrentParams,
    samples: Sequence[Sample],
    analysis: dict,
    abort_reason: AbortReason,
) -> dict:
    """Materialise CSV + summary JSON + hotspot map placeholder.

    Returns paths so callers (FastAPI endpoint / pytest) can verify.
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    csv_path = out_dir / "raw_samples.csv"
    with csv_path.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow([
            "t_s", "current_a", "voltage_v",
            "t_surface_c", "t_jbox_c", "t_ambient_c",
            "arc_flag", "timestamp_ms",
        ])
        for s in samples:
            w.writerow([
                f"{s.t_s:.3f}", f"{s.current_a:.4f}", f"{s.voltage_v:.4f}",
                f"{s.t_surface_c:.3f}", f"{s.t_jbox_c:.3f}", f"{s.t_ambient_c:.3f}",
                int(s.arc_flag), s.timestamp_ms,
            ])

    summary_path = out_dir / "summary.json"
    summary_payload = {
        "session_id": session_id,
        "standard": STANDARD_ID,
        "post_test_standards": list(POST_TEST_STANDARDS),
        "abort_reason": abort_reason.value,
        "params": _params_to_dict(params),
        "analysis": analysis,
        "artifacts": {
            "raw_csv": str(csv_path.name),
            "hotspot_map": "hotspot_map.json",
        },
    }
    summary_path.write_text(json.dumps(summary_payload, indent=2))

    hotspot_path = out_dir / "hotspot_map.json"
    hotspot_path.write_text(json.dumps(
        _hotspot_map(samples), indent=2,
    ))

    return {
        "csv_path": str(csv_path),
        "summary_path": str(summary_path),
        "hotspot_map_path": str(hotspot_path),
    }


def _params_to_dict(p: ReverseCurrentParams) -> dict:
    return {
        "isc_stc_a": p.isc_stc_a,
        "test_current_a": p.test_current_a,
        "duration_s": p.duration_s,
        "sample_interval_s": p.sample_interval_s,
        "ambient_target_c": p.ambient_target_c,
        "ambient_tolerance_c": p.ambient_tolerance_c,
        "abort_temperature_c": p.abort_temperature_c,
        "voltage_clamp_v": p.voltage_clamp_v,
        "fuse_multiplier": p.fuse_multiplier,
        "operator": p.operator,
        "module_serial": p.module_serial,
    }


def _hotspot_map(samples: Sequence[Sample]) -> dict:
    """Peak-temperature map across the (optional) thermal-cam grid.

    Stored as a flat list with metadata so the frontend can render a
    heatmap when (and only when) a thermal camera is wired up. Returns
    an empty map when no grid samples exist.
    """
    grid_size = 0
    peaks: list[float] = []
    for s in samples:
        if s.t_surface_grid_c:
            grid_size = max(grid_size, len(s.t_surface_grid_c))
    if grid_size == 0:
        return {"grid_size": 0, "shape": [0, 0], "peaks_c": []}
    peaks = [0.0] * grid_size
    for s in samples:
        for i, t in enumerate(s.t_surface_grid_c):
            if i < grid_size and t > peaks[i]:
                peaks[i] = t
    side = int(math.isqrt(grid_size))
    if side * side != grid_size:
        side = grid_size
        shape = [1, grid_size]
    else:
        shape = [side, side]
    return {
        "grid_size": grid_size,
        "shape": shape,
        "peaks_c": [round(p, 2) for p in peaks],
    }


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------
SampleListener = Callable[[Sample], Awaitable[None]]


class ReverseCurrentOverloadTest:
    """Orchestrates a full IEC 61730-2 MST 26 run."""

    STANDARD = STANDARD_ID

    def __init__(
        self,
        params: ReverseCurrentParams,
        sampler: Sampler,
        clock: Optional[Callable[[], float]] = None,
        sleep: Optional[Callable[[float], Awaitable[None]]] = None,
    ) -> None:
        params.validate()
        self.params = params
        self.sampler = sampler
        self._clock = clock or time.monotonic
        self._sleep = sleep or asyncio.sleep

        self.session_id = str(uuid.uuid4())
        self.samples: list[Sample] = []
        self._listeners: list[SampleListener] = []
        self._running = False
        self._abort = AbortReason.NONE
        self._started_at_ms = 0
        self._ended_at_ms = 0
        self._task: Optional[asyncio.Task[None]] = None

    # -- listener management ------------------------------------------------
    def add_listener(self, fn: SampleListener) -> None:
        self._listeners.append(fn)

    # -- lifecycle ----------------------------------------------------------
    async def start(self) -> str:
        if self._running:
            raise RuntimeError("test already running")
        self._running = True
        self._abort = AbortReason.NONE
        self._started_at_ms = int(time.time() * 1000)
        self.samples.clear()
        self._task = asyncio.create_task(self._run(), name=f"rco-{self.session_id}")
        return self.session_id

    async def stop(self, reason: AbortReason = AbortReason.OPERATOR_STOP) -> None:
        if not self._running:
            return
        self._abort = reason
        self._running = False
        if self._task is not None:
            await asyncio.gather(self._task, return_exceptions=True)

    async def join(self) -> ReverseCurrentResult:
        """Wait for the run to finish and return the result."""
        if self._task is None:
            raise RuntimeError("test not started")
        await asyncio.gather(self._task, return_exceptions=True)
        return self.result()

    async def run_to_completion(self, out_dir: Optional[Path] = None) -> ReverseCurrentResult:
        """Convenience: start, await completion, write report.

        Used by tests and the FastAPI synchronous flow.
        """
        await self.start()
        await self.join()
        result = self.result()
        if out_dir is not None:
            paths = write_report(
                out_dir, self.session_id, self.params,
                self.samples, result.analysis, self._abort,
            )
            result = ReverseCurrentResult(
                session_id=result.session_id,
                started_at_ms=result.started_at_ms,
                ended_at_ms=result.ended_at_ms,
                params=result.params,
                sample_count=result.sample_count,
                duration_s=result.duration_s,
                abort_reason=result.abort_reason,
                passed=result.passed,
                analysis=result.analysis,
                csv_path=paths["csv_path"],
                summary_path=paths["summary_path"],
                hotspot_map_path=paths["hotspot_map_path"],
            )
        return result

    # -- introspection ------------------------------------------------------
    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def abort_reason(self) -> AbortReason:
        return self._abort

    def result(self) -> ReverseCurrentResult:
        abort = self._abort
        if abort == AbortReason.NONE:
            abort = AbortReason.COMPLETED
        analysis = analyse(self.samples, self.params, abort)
        duration_s = self.samples[-1].t_s if self.samples else 0.0
        return ReverseCurrentResult(
            session_id=self.session_id,
            started_at_ms=self._started_at_ms,
            ended_at_ms=self._ended_at_ms or int(time.time() * 1000),
            params=_params_to_dict(self.params),
            sample_count=len(self.samples),
            duration_s=duration_s,
            abort_reason=abort,
            passed=analysis["passed"],
            analysis=analysis,
            csv_path=None,
            summary_path=None,
            hotspot_map_path=None,
        )

    # -- core loop ----------------------------------------------------------
    async def _run(self) -> None:
        p = self.params
        t0 = self._clock()
        next_tick = t0
        try:
            while self._running:
                now = self._clock()
                t_s = now - t0
                if t_s >= p.duration_s:
                    self._abort = AbortReason.COMPLETED
                    self._running = False
                    break

                sample = await self.sampler(t_s)
                # Defensive: enforce magnitude/sign.
                sample.current_a = abs(sample.current_a)
                self.samples.append(sample)
                await self._dispatch(sample)

                abort = self._check_abort(sample)
                if abort != AbortReason.NONE:
                    self._abort = abort
                    self._running = False
                    break

                next_tick += p.sample_interval_s
                delay = max(0.0, next_tick - self._clock())
                if delay > 0:
                    await self._sleep(delay)
        finally:
            self._running = False
            self._ended_at_ms = int(time.time() * 1000)

    async def _dispatch(self, sample: Sample) -> None:
        for fn in self._listeners:
            try:
                await fn(sample)
            except Exception:
                # A failed listener must not abort the run; the safety
                # checks are in _check_abort, not in fan-out.
                continue

    def _check_abort(self, s: Sample) -> AbortReason:
        p = self.params
        if s.t_surface_c >= p.abort_temperature_c:
            return AbortReason.OVER_TEMPERATURE
        if s.t_jbox_c >= p.abort_temperature_c:
            return AbortReason.OVER_TEMPERATURE
        if s.t_surface_grid_c and max(s.t_surface_grid_c) >= p.abort_temperature_c:
            return AbortReason.OVER_TEMPERATURE
        if s.arc_flag:
            return AbortReason.ARC_DETECTED
        if abs(s.voltage_v) > p.voltage_clamp_v * 1.05:
            return AbortReason.VOLTAGE_CLAMP
        # Ambient interlock: only abort once we're meaningfully past warmup.
        if s.t_s > 30.0:
            if s.t_ambient_c > p.ambient_target_c + p.ambient_tolerance_c:
                return AbortReason.AMBIENT_OUT_OF_RANGE
            if s.t_ambient_c < p.ambient_target_c - p.ambient_tolerance_c:
                return AbortReason.AMBIENT_OUT_OF_RANGE
        return AbortReason.NONE


# ---------------------------------------------------------------------------
# Convenience: build a demo orchestrator at fast-forward speed.
# ---------------------------------------------------------------------------
def build_demo(
    params: Optional[ReverseCurrentParams] = None,
    *,
    seed: int = 0xA6E1,
    force_arc_at_s: Optional[float] = None,
) -> ReverseCurrentOverloadTest:
    """Return an orchestrator wired to ``DemoSimulator`` with a virtual clock.

    The returned test runs at simulated 1 s per sample but uses
    ``asyncio.sleep(0)`` so unit tests complete in milliseconds.
    """
    params = params or ReverseCurrentParams(isc_stc_a=10.0, duration_s=10, sample_interval_s=1.0)
    sim = DemoSimulator(params, rng=random.Random(seed), force_arc_at_s=force_arc_at_s)

    virtual_now = 0.0
    step = params.sample_interval_s

    def clock() -> float:
        return virtual_now

    async def sleep(_d: float) -> None:
        nonlocal virtual_now
        virtual_now += step
        # Yield to the loop so other tasks can run.
        await asyncio.sleep(0)

    return ReverseCurrentOverloadTest(params, sampler=sim, clock=clock, sleep=sleep)


__all__ = [
    "AbortReason",
    "DEFAULT_ABORT_T_C",
    "DEFAULT_AMBIENT_TARGET_C",
    "DEFAULT_AMBIENT_TOLERANCE_C",
    "DEFAULT_DURATION_S",
    "DEFAULT_SAMPLE_INTERVAL_S",
    "DEFAULT_VOLTAGE_CLAMP_V",
    "DemoSimulator",
    "FUSE_MULTIPLIER",
    "POST_TEST_STANDARDS",
    "ReverseCurrentOverloadTest",
    "ReverseCurrentParams",
    "ReverseCurrentResult",
    "STANDARD_ID",
    "Sample",
    "analyse",
    "build_demo",
    "write_report",
]
