"""IEC 61215-2 MQT 13 — Damp Heat orchestrator.

Standard
--------
IEC 61215-2 clause 4.13 (MQT 13). The module is held at
``85 °C ± 2 °C`` and ``85 % RH ± 5 %`` for ``1000 h`` (+480 / -0).
Terminals are short-circuited unless a technology-specific bias
current is required by IEC 61215-1.

This module bundles four concerns so the FastAPI control plane can
drive a damp-heat run end-to-end:

* :class:`DampHeatSession` — long-running orchestrator with start/stop,
  1-minute environmental logging, and CSV persistence.
* :class:`DampHeatSimulator` — physically plausible T/RH trace with
  startup ramp, slow drift, and bounded noise; used in demo mode and
  in unit tests.
* :class:`DampHeatAnalyzer` — IEC tolerance accounting (cumulative
  in-tolerance dwell) plus MQT 01 (visual) and MQT 15 (insulation)
  stub gates and the Gate-2 power-loss check.
* :class:`DampHeatReport` — pure-Python report assembly (no third-party
  charting); produces a JSON payload that the frontend report panel
  and the PDF/Word exporters consume.

The implementation is deliberately import-light (stdlib only) so the
backend test suite runs without optional binary deps.
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
from pathlib import Path
from typing import Awaitable, Callable, Iterable, Optional


# ---------------------------------------------------------------------------
# IEC 61215-2 MQT 13 constants — clause 4.13
# ---------------------------------------------------------------------------
IEC_CLAUSE = "IEC 61215-2:2021 clause 4.13 (MQT 13 — Damp Heat)"
TARGET_TEMP_C = 85.0
TARGET_RH_PCT = 85.0
TEMP_TOLERANCE_C = 2.0
RH_TOLERANCE_PCT = 5.0
TARGET_DURATION_H = 1000.0
DURATION_TOLERANCE_PLUS_H = 480.0
DURATION_TOLERANCE_MINUS_H = 0.0
SAMPLE_CADENCE_S = 60.0  # 1 minute per IEC requirement
GATE2_MAX_POWER_LOSS_PCT = 5.0  # Pmax decay ≤ 5 % of initial baseline


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class EnvSample:
    """One environmental log entry — single minute snapshot."""
    t_s: float          # seconds since session start
    temperature_c: float
    humidity_pct: float

    @property
    def in_tolerance(self) -> bool:
        return (
            abs(self.temperature_c - TARGET_TEMP_C) <= TEMP_TOLERANCE_C
            and abs(self.humidity_pct - TARGET_RH_PCT) <= RH_TOLERANCE_PCT
        )

    def to_dict(self) -> dict:
        return {
            "t_s": self.t_s,
            "temperature_c": self.temperature_c,
            "humidity_pct": self.humidity_pct,
            "in_tolerance": self.in_tolerance,
        }


@dataclass
class DampHeatConfig:
    target_temp_c: float = TARGET_TEMP_C
    target_rh_pct: float = TARGET_RH_PCT
    temp_tolerance_c: float = TEMP_TOLERANCE_C
    rh_tolerance_pct: float = RH_TOLERANCE_PCT
    duration_h: float = TARGET_DURATION_H
    cadence_s: float = SAMPLE_CADENCE_S
    bias_current_a: float = 0.0  # 0 = terminals shorted per default MQT 13
    gate2_max_loss_pct: float = GATE2_MAX_POWER_LOSS_PCT

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class GateResult:
    name: str
    clause: str
    status: str           # "pass" | "fail" | "pending" | "skipped"
    detail: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Simulator
# ---------------------------------------------------------------------------
class DampHeatSimulator:
    """Physically plausible 85/85 chamber model.

    Behaviour
    ---------
    - Linear ramp from ambient to set-point (~30 min, chamber-typical).
    - Slow sinusoidal drift around set-point (24 h period) so a long
      run shows realistic in/out-of-tolerance excursions.
    - Bounded Gaussian noise on each axis.
    - Optional ``drift_bias`` lets a test force out-of-tolerance bands
      to exercise the analyser without monkey-patching.
    """

    def __init__(
        self,
        target_temp_c: float = TARGET_TEMP_C,
        target_rh_pct: float = TARGET_RH_PCT,
        ramp_minutes: float = 30.0,
        temp_noise_c: float = 0.4,
        rh_noise_pct: float = 1.2,
        drift_amp_temp_c: float = 0.6,
        drift_amp_rh_pct: float = 1.5,
        drift_bias_temp_c: float = 0.0,
        drift_bias_rh_pct: float = 0.0,
        seed: Optional[int] = None,
    ) -> None:
        self.target_temp_c = target_temp_c
        self.target_rh_pct = target_rh_pct
        self.ramp_s = max(1.0, ramp_minutes * 60.0)
        self.temp_noise_c = temp_noise_c
        self.rh_noise_pct = rh_noise_pct
        self.drift_amp_temp_c = drift_amp_temp_c
        self.drift_amp_rh_pct = drift_amp_rh_pct
        self.drift_bias_temp_c = drift_bias_temp_c
        self.drift_bias_rh_pct = drift_bias_rh_pct
        self._rng = random.Random(seed)
        self._ambient_t = 25.0
        self._ambient_rh = 45.0

    def sample(self, t_s: float) -> EnvSample:
        """Return a synthetic ``EnvSample`` at session-elapsed ``t_s``."""
        if t_s < 0:
            t_s = 0.0
        ramp = min(1.0, t_s / self.ramp_s)
        # Smooth ramp-in (cosine ease) so the trace looks realistic.
        ease = 0.5 - 0.5 * math.cos(math.pi * ramp)
        base_t = self._ambient_t + (self.target_temp_c - self._ambient_t) * ease
        base_rh = self._ambient_rh + (self.target_rh_pct - self._ambient_rh) * ease

        # 24 h drift envelope — only active once the chamber has reached set-point.
        day_phase = 2 * math.pi * (t_s / 86400.0)
        drift_t = self.drift_amp_temp_c * math.sin(day_phase) if ramp >= 1.0 else 0.0
        drift_rh = self.drift_amp_rh_pct * math.cos(day_phase) if ramp >= 1.0 else 0.0

        noise_t = self._rng.gauss(0.0, self.temp_noise_c)
        noise_rh = self._rng.gauss(0.0, self.rh_noise_pct)

        temp = base_t + drift_t + self.drift_bias_temp_c + noise_t
        rh = base_rh + drift_rh + self.drift_bias_rh_pct + noise_rh
        # Clamp humidity to physical range — RH cannot exceed 100 %.
        rh = max(0.0, min(100.0, rh))
        return EnvSample(t_s=t_s, temperature_c=round(temp, 3), humidity_pct=round(rh, 3))

    def trace(self, duration_s: float, cadence_s: float = SAMPLE_CADENCE_S) -> list[EnvSample]:
        """Pre-compute a deterministic full-run trace (used by analyser tests)."""
        n = max(1, int(duration_s // cadence_s) + 1)
        return [self.sample(i * cadence_s) for i in range(n)]


# ---------------------------------------------------------------------------
# Analyser
# ---------------------------------------------------------------------------
@dataclass
class DampHeatAnalysis:
    samples: int
    in_tolerance_samples: int
    in_tolerance_fraction: float
    in_tolerance_duration_h: float
    total_duration_h: float
    duration_pass: bool
    temp_excursions: int
    rh_excursions: int
    pmax_loss_pct: Optional[float]
    gate2: GateResult
    mqt01: GateResult
    mqt15: GateResult
    overall: str  # "pass" | "fail" | "pending"

    def to_dict(self) -> dict:
        out = asdict(self)
        out["gate2"] = self.gate2.to_dict()
        out["mqt01"] = self.mqt01.to_dict()
        out["mqt15"] = self.mqt15.to_dict()
        return out


class DampHeatAnalyzer:
    """Computes the IEC pass/fail picture from a sample stream."""

    def __init__(self, config: Optional[DampHeatConfig] = None) -> None:
        self.config = config or DampHeatConfig()

    def cumulative_dwell(self, samples: Iterable[EnvSample]) -> tuple[int, int]:
        """Return ``(total, in_tolerance)`` sample counts."""
        total = 0
        good = 0
        for s in samples:
            total += 1
            if s.in_tolerance:
                good += 1
        return total, good

    def excursions(self, samples: Iterable[EnvSample]) -> tuple[int, int]:
        """Return ``(temp_excursion_count, rh_excursion_count)``."""
        t_ex = 0
        rh_ex = 0
        for s in samples:
            if abs(s.temperature_c - self.config.target_temp_c) > self.config.temp_tolerance_c:
                t_ex += 1
            if abs(s.humidity_pct - self.config.target_rh_pct) > self.config.rh_tolerance_pct:
                rh_ex += 1
        return t_ex, rh_ex

    def gate2(self, pre_pmax: Optional[float], post_pmax: Optional[float]) -> GateResult:
        """Apply the Gate-2 Pmax loss criterion (≤5 % decay)."""
        if pre_pmax is None or post_pmax is None or pre_pmax <= 0:
            return GateResult(
                name="Gate 2 — Pmax retention",
                clause="IEC 61215-1 §8 Gate 2",
                status="pending",
                detail="Pre/post Pmax not yet recorded.",
            )
        loss_pct = (pre_pmax - post_pmax) / pre_pmax * 100.0
        passing = loss_pct <= self.config.gate2_max_loss_pct
        return GateResult(
            name="Gate 2 — Pmax retention",
            clause="IEC 61215-1 §8 Gate 2",
            status="pass" if passing else "fail",
            detail=f"Pmax loss = {loss_pct:+.2f} % (limit ≤ {self.config.gate2_max_loss_pct:.1f} %)",
        )

    def mqt01_stub(self, visual_defects: int = 0) -> GateResult:
        """MQT 01 — Visual inspection (placeholder for operator entry)."""
        return GateResult(
            name="MQT 01 — Visual inspection",
            clause="IEC 61215-2 clause 4.1",
            status="pass" if visual_defects == 0 else "fail",
            detail=(
                "No major visual defects logged."
                if visual_defects == 0
                else f"{visual_defects} major defect(s) reported."
            ),
        )

    def mqt15_stub(self, insulation_mohm: Optional[float] = None) -> GateResult:
        """MQT 15 — Wet leakage current / insulation resistance stub."""
        if insulation_mohm is None:
            return GateResult(
                name="MQT 15 — Wet leakage / insulation",
                clause="IEC 61215-2 clause 4.15",
                status="pending",
                detail="Post-stress insulation measurement not yet entered.",
            )
        # IEC 61730 requires ≥ 40 MΩ·m² for modules ≤ 0.1 m² and the
        # ratio test for larger modules. We use a flat 40 MΩ floor as a
        # demo threshold; production replaces this with the area calc.
        ok = insulation_mohm >= 40.0
        return GateResult(
            name="MQT 15 — Wet leakage / insulation",
            clause="IEC 61215-2 clause 4.15",
            status="pass" if ok else "fail",
            detail=f"Insulation = {insulation_mohm:.1f} MΩ (limit ≥ 40 MΩ).",
        )

    def analyse(
        self,
        samples: list[EnvSample],
        pre_pmax: Optional[float] = None,
        post_pmax: Optional[float] = None,
        visual_defects: int = 0,
        insulation_mohm: Optional[float] = None,
    ) -> DampHeatAnalysis:
        total, good = self.cumulative_dwell(samples)
        t_ex, rh_ex = self.excursions(samples)
        cadence = self.config.cadence_s
        total_h = (total * cadence) / 3600.0
        good_h = (good * cadence) / 3600.0
        # Duration tolerance: 1000 h +480 / -0
        min_h = self.config.duration_h
        max_h = self.config.duration_h + DURATION_TOLERANCE_PLUS_H
        duration_pass = good_h >= min_h and total_h <= max_h
        gate2 = self.gate2(pre_pmax, post_pmax)
        mqt01 = self.mqt01_stub(visual_defects)
        mqt15 = self.mqt15_stub(insulation_mohm)
        gates = [gate2.status, mqt01.status, mqt15.status]
        if "fail" in gates or not duration_pass:
            overall = "fail" if total_h >= min_h else "pending"
            if "fail" in gates:
                overall = "fail"
        elif "pending" in gates or total_h < min_h:
            overall = "pending"
        else:
            overall = "pass"
        pmax_loss = None
        if pre_pmax and post_pmax and pre_pmax > 0:
            pmax_loss = (pre_pmax - post_pmax) / pre_pmax * 100.0
        return DampHeatAnalysis(
            samples=total,
            in_tolerance_samples=good,
            in_tolerance_fraction=(good / total) if total else 0.0,
            in_tolerance_duration_h=round(good_h, 3),
            total_duration_h=round(total_h, 3),
            duration_pass=duration_pass,
            temp_excursions=t_ex,
            rh_excursions=rh_ex,
            pmax_loss_pct=round(pmax_loss, 3) if pmax_loss is not None else None,
            gate2=gate2,
            mqt01=mqt01,
            mqt15=mqt15,
            overall=overall,
        )


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
class DampHeatReport:
    """Assembles a structured report dict for the frontend / exporters."""

    @staticmethod
    def build(
        session_id: str,
        config: DampHeatConfig,
        samples: list[EnvSample],
        analysis: DampHeatAnalysis,
        csv_path: Optional[str] = None,
        pre_pmax: Optional[float] = None,
        post_pmax: Optional[float] = None,
        started_at: Optional[float] = None,
        ended_at: Optional[float] = None,
        notes: str = "",
    ) -> dict:
        timeline = [s.to_dict() for s in samples]
        return {
            "session_id": session_id,
            "test": "Damp Heat",
            "standard": "IEC 61215-2 MQT 13",
            "iec_clause": IEC_CLAUSE,
            "config": config.to_dict(),
            "started_at": started_at,
            "ended_at": ended_at,
            "pre_pmax_w": pre_pmax,
            "post_pmax_w": post_pmax,
            "raw_csv_path": csv_path,
            "analysis": analysis.to_dict(),
            "timeline": timeline,
            "result": analysis.overall.upper(),
            "notes": notes,
        }


# ---------------------------------------------------------------------------
# Session orchestrator
# ---------------------------------------------------------------------------
ReadingCallback = Callable[[dict], Awaitable[None]]


@dataclass
class _SessionState:
    samples: list[EnvSample] = field(default_factory=list)
    started_at: Optional[float] = None
    ended_at: Optional[float] = None
    pre_pmax: Optional[float] = None
    post_pmax: Optional[float] = None
    aborted: bool = False


class DampHeatSession:
    """Long-running orchestrator for one MQT 13 run.

    Designed to be driven either from a WebSocket task or from a CLI
    one-shot. In demo mode the loop is fully synthetic; in live mode
    the same loop pulls T/RH from the chamber controller (placeholder
    callable supplied at construction time).
    """

    def __init__(
        self,
        config: Optional[DampHeatConfig] = None,
        simulator: Optional[DampHeatSimulator] = None,
        sensor_reader: Optional[Callable[[float], EnvSample]] = None,
        csv_dir: Optional[Path] = None,
        time_scale: float = 1.0,
    ) -> None:
        self.config = config or DampHeatConfig()
        self.simulator = simulator or DampHeatSimulator(
            target_temp_c=self.config.target_temp_c,
            target_rh_pct=self.config.target_rh_pct,
        )
        # ``sensor_reader`` is the hardware path; defaults to simulator.
        self._sensor_reader = sensor_reader or self.simulator.sample
        self.csv_dir = csv_dir or Path("logs/damp_heat")
        # ``time_scale > 1`` compresses wall-clock so tests don't wait
        # 1000 hours. Each ``cadence_s`` advances ``cadence_s * scale``
        # of session-virtual time.
        self.time_scale = max(1.0, time_scale)
        self.session_id = f"DH-{uuid.uuid4().hex[:8]}"
        self.analyzer = DampHeatAnalyzer(self.config)
        self.state = _SessionState()
        self._stop_evt = asyncio.Event()
        self.csv_path: Optional[Path] = None

    # -- lifecycle ----------------------------------------------------
    def set_pre_pmax(self, pmax_w: float) -> None:
        self.state.pre_pmax = pmax_w

    def set_post_pmax(self, pmax_w: float) -> None:
        self.state.post_pmax = pmax_w

    def stop(self) -> None:
        self._stop_evt.set()

    @property
    def samples(self) -> list[EnvSample]:
        return list(self.state.samples)

    # -- main loop ----------------------------------------------------
    async def run(
        self,
        on_sample: Optional[ReadingCallback] = None,
        max_samples: Optional[int] = None,
        sleep_fn: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> dict:
        """Drive the test until duration is met or ``stop`` is called.

        ``on_sample`` is awaited once per minute with the JSON payload
        the WebSocket layer forwards to the UI. ``max_samples`` short-
        circuits the loop for tests; ``sleep_fn`` is injectable so a
        unit test can run a 1000-hour trace in milliseconds.
        """
        self.state.started_at = time.time()
        self._open_csv()
        duration_s = self.config.duration_h * 3600.0
        cadence = self.config.cadence_s
        t_virtual = 0.0
        try:
            while not self._stop_evt.is_set():
                sample = self._sensor_reader(t_virtual)
                self.state.samples.append(sample)
                self._append_csv(sample)
                if on_sample is not None:
                    await on_sample(self._payload(sample))
                if t_virtual >= duration_s:
                    break
                if max_samples is not None and len(self.state.samples) >= max_samples:
                    break
                # Real wait is cadence_s / time_scale so tests run fast.
                await sleep_fn(cadence / self.time_scale)
                t_virtual += cadence
        finally:
            self.state.ended_at = time.time()
        return self.build_report()

    def _payload(self, sample: EnvSample) -> dict:
        return {
            "type": "damp_heat_sample",
            "session_id": self.session_id,
            "ts": int(time.time() * 1000),
            "t_s": sample.t_s,
            "temperature": sample.temperature_c,
            "T": sample.temperature_c,
            "humidity": sample.humidity_pct,
            "RH": sample.humidity_pct,
            "in_tolerance": sample.in_tolerance,
        }

    # -- CSV persistence ---------------------------------------------
    def _open_csv(self) -> None:
        self.csv_dir.mkdir(parents=True, exist_ok=True)
        self.csv_path = self.csv_dir / f"{self.session_id}.csv"
        with self.csv_path.open("w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["t_s", "temperature_c", "humidity_pct", "in_tolerance"])

    def _append_csv(self, sample: EnvSample) -> None:
        if self.csv_path is None:
            return
        with self.csv_path.open("a", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow([
                f"{sample.t_s:.1f}",
                f"{sample.temperature_c:.3f}",
                f"{sample.humidity_pct:.3f}",
                int(sample.in_tolerance),
            ])

    # -- report ------------------------------------------------------
    def build_report(
        self,
        visual_defects: int = 0,
        insulation_mohm: Optional[float] = None,
        notes: str = "",
    ) -> dict:
        analysis = self.analyzer.analyse(
            self.state.samples,
            pre_pmax=self.state.pre_pmax,
            post_pmax=self.state.post_pmax,
            visual_defects=visual_defects,
            insulation_mohm=insulation_mohm,
        )
        return DampHeatReport.build(
            session_id=self.session_id,
            config=self.config,
            samples=self.state.samples,
            analysis=analysis,
            csv_path=str(self.csv_path) if self.csv_path else None,
            pre_pmax=self.state.pre_pmax,
            post_pmax=self.state.post_pmax,
            started_at=self.state.started_at,
            ended_at=self.state.ended_at,
            notes=notes,
        )

    def report_json(self, **kwargs) -> str:
        return json.dumps(self.build_report(**kwargs), indent=2)


__all__ = [
    "IEC_CLAUSE",
    "TARGET_TEMP_C",
    "TARGET_RH_PCT",
    "TEMP_TOLERANCE_C",
    "RH_TOLERANCE_PCT",
    "TARGET_DURATION_H",
    "SAMPLE_CADENCE_S",
    "GATE2_MAX_POWER_LOSS_PCT",
    "EnvSample",
    "DampHeatConfig",
    "GateResult",
    "DampHeatSimulator",
    "DampHeatAnalysis",
    "DampHeatAnalyzer",
    "DampHeatReport",
    "DampHeatSession",
]
