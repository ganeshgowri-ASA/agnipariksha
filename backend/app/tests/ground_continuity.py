"""Ground Continuity Test orchestrator — IEC 61730-2 (MST 13).

Standard summary
----------------
Apply a test current of ``max(2.5 x I_module_rated, 25 A)`` DC between the
module's earthing point and *each* exposed accessible conductive part for
2 minutes, measure voltage drop, and compute resistance ``R = V / I``.
The continuity is acceptable if R <= 0.1 ohm at every probe point.

Module structure
----------------
- :class:`GroundContinuityConfig` — test parameters & probe map.
- :class:`ProbeResult`            — per-point trace + scalar results.
- :class:`GroundContinuityResult` — full session result (all probes).
- :func:`compute_test_current`    — IEC 61730-2 current calculation.
- :func:`simulate_probe_trace`    — physically-plausible V/I demo trace.
- :func:`analyze_probe_trace`     — resistance + contact-stability metric.
- :class:`GroundContinuityOrchestrator` — runs the full multi-probe sweep
  (real or demo), writes per-probe CSVs, returns an aggregated result.

Everything is independently importable so unit tests can exercise the
analysis math without spinning up a power supply.
"""
from __future__ import annotations

import asyncio
import csv
import math
import random
import statistics
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Awaitable, Callable, Iterable, List, Optional, Sequence


# ---------------------------------------------------------------------------
# Constants pinned by IEC 61730-2 MST 13.
# ---------------------------------------------------------------------------
STANDARD_REF = "IEC 61730-2 MST 13 (Continuity of equipotential bonding)"
MIN_TEST_CURRENT_A = 25.0
RATED_CURRENT_MULTIPLIER = 2.5
MAX_RESISTANCE_OHM = 0.1
DURATION_PER_POINT_S = 120.0  # 2 minutes per probe per IEC 61730-2.
DEFAULT_SAMPLE_HZ = 5.0


def compute_test_current(rated_module_current_a: float) -> float:
    """``max(2.5 * I_rated, 25 A)`` per IEC 61730-2 MST 13."""
    if rated_module_current_a < 0:
        raise ValueError("rated_module_current_a must be >= 0")
    return max(RATED_CURRENT_MULTIPLIER * rated_module_current_a, MIN_TEST_CURRENT_A)


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------
@dataclass
class ProbePoint:
    """A single probed exposed accessible conductive part."""
    id: str
    label: str
    # Normalised position on the module diagram (0..1, origin top-left).
    x: float = 0.5
    y: float = 0.5
    # Optional ground-truth resistance used by the demo simulator only.
    sim_resistance_ohm: float = 0.05
    # Optional 1-sigma contact noise (ohms) added to the simulated trace.
    sim_contact_noise_ohm: float = 0.005


@dataclass
class GroundContinuityConfig:
    """Inputs for a single MST 13 run."""
    module_id: str = "MOD-DEFAULT"
    rated_module_current_a: float = 9.5
    duration_per_point_s: float = DURATION_PER_POINT_S
    sample_rate_hz: float = DEFAULT_SAMPLE_HZ
    pass_resistance_ohm: float = MAX_RESISTANCE_OHM
    probe_points: List[ProbePoint] = field(default_factory=list)
    # Override the IEC formula (kept None to honour the standard).
    test_current_a_override: Optional[float] = None
    # Where per-probe CSV traces are written.
    artifact_dir: str = "artifacts/ground_continuity"

    @property
    def test_current_a(self) -> float:
        if self.test_current_a_override is not None:
            return float(self.test_current_a_override)
        return compute_test_current(self.rated_module_current_a)

    @classmethod
    def default_probe_map(cls) -> List[ProbePoint]:
        """The five canonical probe points used by the demo configuration:
        four frame corners + the junction-box ground tab."""
        return [
            ProbePoint("p1", "Frame TL", x=0.05, y=0.05, sim_resistance_ohm=0.045),
            ProbePoint("p2", "Frame TR", x=0.95, y=0.05, sim_resistance_ohm=0.052),
            ProbePoint("p3", "Frame BL", x=0.05, y=0.95, sim_resistance_ohm=0.048),
            ProbePoint("p4", "Frame BR", x=0.95, y=0.95, sim_resistance_ohm=0.061),
            ProbePoint("p5", "J-Box GND", x=0.50, y=0.55, sim_resistance_ohm=0.038),
        ]


@dataclass
class TraceSample:
    t_s: float
    voltage_v: float
    current_a: float

    def to_dict(self) -> dict:
        return {"t_s": self.t_s, "voltage_v": self.voltage_v, "current_a": self.current_a}


@dataclass
class ProbeResult:
    """Analysis result for a single probed point."""
    probe_id: str
    label: str
    test_current_a: float
    duration_s: float
    n_samples: int
    mean_voltage_v: float
    mean_current_a: float
    resistance_ohm: float
    resistance_min_ohm: float
    resistance_max_ohm: float
    contact_stability_pct: float  # 100*(1 - sigma_R/mean_R), clipped to [0, 100]
    pass_resistance_ohm: float
    passed: bool
    csv_path: Optional[str] = None
    samples: List[TraceSample] = field(default_factory=list)

    def to_dict(self, include_samples: bool = False) -> dict:
        d = asdict(self)
        if not include_samples:
            d.pop("samples", None)
        else:
            d["samples"] = [s.to_dict() for s in self.samples]
        return d


@dataclass
class GroundContinuityResult:
    session_id: str
    module_id: str
    standard: str
    started_ts: float
    ended_ts: float
    test_current_a: float
    pass_resistance_ohm: float
    probes: List[ProbeResult]
    overall_pass: bool
    artifact_dir: str

    def to_dict(self, include_samples: bool = False) -> dict:
        return {
            "session_id": self.session_id,
            "module_id": self.module_id,
            "standard": self.standard,
            "started_ts": self.started_ts,
            "ended_ts": self.ended_ts,
            "test_current_a": self.test_current_a,
            "pass_resistance_ohm": self.pass_resistance_ohm,
            "overall_pass": self.overall_pass,
            "result": "PASS" if self.overall_pass else "FAIL",
            "artifact_dir": self.artifact_dir,
            "probes": [p.to_dict(include_samples=include_samples) for p in self.probes],
        }


# ---------------------------------------------------------------------------
# Demo simulator
# ---------------------------------------------------------------------------
def simulate_probe_trace(
    probe: ProbePoint,
    *,
    test_current_a: float,
    duration_s: float,
    sample_rate_hz: float = DEFAULT_SAMPLE_HZ,
    rng: Optional[random.Random] = None,
) -> List[TraceSample]:
    """Generate a physically plausible V/I trace for one probe.

    Voltage drop is modelled as ``V = R_contact * I + n_v`` where:
    - ``R_contact`` is the probe's intrinsic resistance plus a slow
      drift representing contact bedding-in (small exponential decay).
    - ``I`` is the source current with a small ripple + Gaussian noise
      representing supply regulation.
    - ``n_v`` is Gaussian voltage noise scaled by the configured contact
      noise (volts = noise_ohms * I).
    """
    rng = rng or random.Random(hash(probe.id) & 0xFFFFFFFF)
    n = max(2, int(duration_s * sample_rate_hz))
    dt = duration_s / n
    samples: List[TraceSample] = []

    # Bedding-in drift: contact resistance starts ~10% high then decays.
    r0 = probe.sim_resistance_ohm * 1.10
    r_inf = probe.sim_resistance_ohm
    tau = max(0.5, duration_s * 0.15)  # decay time constant.

    for k in range(n):
        t = k * dt
        # Slow exponential decay toward steady-state contact R.
        r_contact = r_inf + (r0 - r_inf) * math.exp(-t / tau)
        # Source current: small 1% ripple + jitter.
        i = test_current_a * (1.0 + 0.005 * math.sin(2 * math.pi * t / 1.7))
        i += rng.gauss(0.0, 0.01 * test_current_a)
        # Voltage drop with contact noise (in ohms) coupled through I.
        noise_v = rng.gauss(0.0, probe.sim_contact_noise_ohm) * test_current_a
        v = r_contact * i + noise_v
        samples.append(TraceSample(t_s=round(t, 6), voltage_v=v, current_a=i))
    return samples


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------
def analyze_probe_trace(
    probe: ProbePoint,
    samples: Sequence[TraceSample],
    *,
    test_current_a: float,
    pass_resistance_ohm: float = MAX_RESISTANCE_OHM,
    settle_fraction: float = 0.2,
) -> ProbeResult:
    """Compute steady-state resistance, contact stability, pass/fail.

    The first ``settle_fraction`` of samples is discarded so the
    bedding-in transient does not bias the steady-state resistance.
    """
    if not samples:
        raise ValueError("samples must be non-empty")

    n_total = len(samples)
    skip = max(1, int(n_total * settle_fraction))
    steady = list(samples[skip:]) or list(samples[-1:])

    # Per-sample resistance (guarding against tiny currents).
    resistances = [
        (s.voltage_v / s.current_a) if abs(s.current_a) > 1e-3 else float("inf")
        for s in steady
    ]
    finite = [r for r in resistances if math.isfinite(r)]
    if not finite:
        raise ValueError("no finite resistance samples")

    mean_v = statistics.fmean(s.voltage_v for s in steady)
    mean_i = statistics.fmean(s.current_a for s in steady)
    r_mean = statistics.fmean(finite)
    r_min = min(finite)
    r_max = max(finite)
    if len(finite) >= 2:
        r_sigma = statistics.pstdev(finite)
    else:
        r_sigma = 0.0
    # Contact stability: 100*(1 - sigma/mean), clamped to [0, 100].
    if r_mean > 0:
        stability = max(0.0, min(100.0, 100.0 * (1.0 - r_sigma / r_mean)))
    else:
        stability = 0.0

    duration_s = steady[-1].t_s - steady[0].t_s if len(steady) > 1 else 0.0

    return ProbeResult(
        probe_id=probe.id,
        label=probe.label,
        test_current_a=test_current_a,
        duration_s=round(duration_s, 4),
        n_samples=n_total,
        mean_voltage_v=round(mean_v, 6),
        mean_current_a=round(mean_i, 6),
        resistance_ohm=round(r_mean, 6),
        resistance_min_ohm=round(r_min, 6),
        resistance_max_ohm=round(r_max, 6),
        contact_stability_pct=round(stability, 3),
        pass_resistance_ohm=pass_resistance_ohm,
        passed=r_mean <= pass_resistance_ohm,
    )


def write_probe_csv(path: Path, probe: ProbePoint, samples: Iterable[TraceSample]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["t_s", "voltage_v", "current_a", "probe_id", "probe_label"])
        for s in samples:
            w.writerow([f"{s.t_s:.6f}", f"{s.voltage_v:.6f}", f"{s.current_a:.6f}",
                        probe.id, probe.label])
    return path


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------
ProgressCallback = Callable[[dict], Awaitable[None]]


class GroundContinuityOrchestrator:
    """Runs the full multi-probe MST 13 sweep.

    In demo mode (or when ``scpi`` is None) the orchestrator generates
    traces with :func:`simulate_probe_trace`. With a live ``ScpiClient``
    it programs the supply for constant current, then samples V/I at the
    configured rate for ``duration_per_point_s`` seconds.
    """

    def __init__(
        self,
        config: GroundContinuityConfig,
        scpi: Optional[object] = None,
        *,
        demo_mode: bool = True,
        progress: Optional[ProgressCallback] = None,
        clock: Callable[[], float] = time.time,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        if not config.probe_points:
            config.probe_points = GroundContinuityConfig.default_probe_map()
        self.config = config
        self.scpi = scpi
        self.demo_mode = demo_mode or scpi is None
        self.progress = progress
        self._clock = clock
        self._sleep = sleep
        self.session_id = str(uuid.uuid4())

    async def _emit(self, event: dict) -> None:
        if self.progress is None:
            return
        try:
            await self.progress(event)
        except Exception:
            pass

    async def _configure_supply(self, current_a: float) -> None:
        if self.scpi is None or self.demo_mode:
            return
        await self.scpi.send("SOUR:FUNC CURR")
        await self.scpi.send(f"SOUR:CURR {current_a:.4f}")
        # Voltage compliance: well above 2.5 V drop limit so CC stays in regulation.
        await self.scpi.send("SOUR:VOLT:LIM 5.0")
        await self.scpi.send("OUTP ON")

    async def _shutdown_supply(self) -> None:
        if self.scpi is None or self.demo_mode:
            return
        try:
            await self.scpi.send("OUTP OFF")
        except Exception:
            pass

    async def _sample_live(
        self,
        duration_s: float,
        sample_rate_hz: float,
    ) -> List[TraceSample]:
        n = max(2, int(duration_s * sample_rate_hz))
        dt = duration_s / n
        samples: List[TraceSample] = []
        t0 = self._clock()
        for k in range(n):
            v = float(await self.scpi.query("MEAS:VOLT?"))  # type: ignore[union-attr]
            i = float(await self.scpi.query("MEAS:CURR?"))  # type: ignore[union-attr]
            samples.append(TraceSample(t_s=self._clock() - t0, voltage_v=v, current_a=i))
            await self._sleep(dt)
        return samples

    async def run(self) -> GroundContinuityResult:
        cfg = self.config
        I_test = cfg.test_current_a
        artifact_dir = Path(cfg.artifact_dir) / self.session_id
        artifact_dir.mkdir(parents=True, exist_ok=True)

        started_ts = self._clock()
        await self._emit({
            "event": "session_started",
            "session_id": self.session_id,
            "test_current_a": I_test,
            "n_probes": len(cfg.probe_points),
            "standard": STANDARD_REF,
        })

        await self._configure_supply(I_test)

        results: List[ProbeResult] = []
        try:
            for idx, probe in enumerate(cfg.probe_points, start=1):
                await self._emit({
                    "event": "probe_started",
                    "probe_id": probe.id, "label": probe.label,
                    "index": idx, "of": len(cfg.probe_points),
                })

                if self.demo_mode or self.scpi is None:
                    samples = simulate_probe_trace(
                        probe,
                        test_current_a=I_test,
                        duration_s=cfg.duration_per_point_s,
                        sample_rate_hz=cfg.sample_rate_hz,
                    )
                else:
                    samples = await self._sample_live(
                        cfg.duration_per_point_s, cfg.sample_rate_hz,
                    )

                pr = analyze_probe_trace(
                    probe, samples,
                    test_current_a=I_test,
                    pass_resistance_ohm=cfg.pass_resistance_ohm,
                )
                csv_path = write_probe_csv(
                    artifact_dir / f"{probe.id}.csv", probe, samples,
                )
                pr.csv_path = str(csv_path)
                pr.samples = samples
                results.append(pr)

                await self._emit({
                    "event": "probe_completed",
                    "probe_id": probe.id,
                    "resistance_ohm": pr.resistance_ohm,
                    "passed": pr.passed,
                })
        finally:
            await self._shutdown_supply()

        ended_ts = self._clock()
        overall = all(p.passed for p in results) if results else False
        result = GroundContinuityResult(
            session_id=self.session_id,
            module_id=cfg.module_id,
            standard=STANDARD_REF,
            started_ts=started_ts,
            ended_ts=ended_ts,
            test_current_a=I_test,
            pass_resistance_ohm=cfg.pass_resistance_ohm,
            probes=results,
            overall_pass=overall,
            artifact_dir=str(artifact_dir),
        )
        await self._emit({
            "event": "session_completed",
            "session_id": self.session_id,
            "overall_pass": overall,
        })
        return result


__all__ = [
    "STANDARD_REF",
    "MIN_TEST_CURRENT_A",
    "RATED_CURRENT_MULTIPLIER",
    "MAX_RESISTANCE_OHM",
    "DURATION_PER_POINT_S",
    "compute_test_current",
    "ProbePoint",
    "GroundContinuityConfig",
    "TraceSample",
    "ProbeResult",
    "GroundContinuityResult",
    "simulate_probe_trace",
    "analyze_probe_trace",
    "write_probe_csv",
    "GroundContinuityOrchestrator",
]
