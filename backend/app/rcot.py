"""Reverse Current Overload Test (RCOT) — IEC 61730-2:2016 MST 26.

Reverse-biases a PV module at 1.35x the max series fuse rating and watches
junction temperature for thermal runaway. LIVE IS HARD-BLOCKED in this build
(see SAFETY.md): only the demo simulator runs. The demo synthesises a Tj ramp
(ambient -> ambient+55 C over the soak) with Gaussian noise, logs every 10 s,
and aborts if Tj exceeds the threshold. PASS requires no abort AND an operator
confirming 'no flame, melting, cracking observed'.
"""
from __future__ import annotations

import logging
import random
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger("rcot")

STANDARD = "IEC 61730-2 MST 26"
OVERLOAD_FACTOR = 1.35  # MST 26: 135 % of max series fuse rating
FUSE_MIN_A, FUSE_MAX_A = 5.0, 30.0
DURATION_MIN_H, DURATION_MAX_H, DURATION_DEFAULT_H = 1.0, 2.5, 2.0
AMBIENT_MIN_C = AMBIENT_DEFAULT_C = 40.0
TJ_ABORT_DEFAULT_C = 200.0
LOG_INTERVAL_S = 10.0
_PEAK_RISE_C, _NOISE_SIGMA_C = 55.0, 0.8  # ambient(40) -> 95 C end-of-soak
PASS, FAIL, UNKNOWN = "PASS", "FAIL", "UNKNOWN"

LIVE_BLOCKED_MESSAGE = (
    "LIVE RCOT BLOCKED - requires verified PSU reverse-polarity driver, "
    "K-type thermocouples, owner physically at bench, and audited E-stop. "
    "Contact owner."
)


class RcotSafetyError(RuntimeError):
    """Raised when Start is attempted without the mandatory safety acks."""


def overload_current_a(fuse_rating_a: float) -> float:
    return round(fuse_rating_a * OVERLOAD_FACTOR, 3)


@dataclass
class RcotParams:
    fuse_rating_a: float
    duration_h: float = DURATION_DEFAULT_H
    ambient_c: float = AMBIENT_DEFAULT_C
    tj_abort_c: float = TJ_ABORT_DEFAULT_C
    owner_at_bench: bool = False
    estop_wired: bool = False
    log_interval_s: float = LOG_INTERVAL_S

    @property
    def test_current_a(self) -> float:
        return overload_current_a(self.fuse_rating_a)


@dataclass
class AbortEvent:
    t_s: float
    temp_c: float
    threshold_c: float


@dataclass
class RcotResult:
    aborted: bool
    peak_temp_c: float
    verdict: str
    samples: list[tuple[float, float]] = field(default_factory=list)  # (t_s, Tj)
    abort_event: Optional[AbortEvent] = None


def validate_start(p: RcotParams) -> None:
    """Gate every Start on valid params AND both safety acknowledgements —
    the checkboxes are mandatory even for DEMO, as training discipline."""
    if not FUSE_MIN_A <= p.fuse_rating_a <= FUSE_MAX_A:
        raise ValueError(f"fuse rating must be {FUSE_MIN_A}-{FUSE_MAX_A} A")
    if not DURATION_MIN_H <= p.duration_h <= DURATION_MAX_H:
        raise ValueError(f"duration must be {DURATION_MIN_H}-{DURATION_MAX_H} h")
    if p.ambient_c < AMBIENT_MIN_C:
        raise ValueError(f"ambient must be >= {AMBIENT_MIN_C} C")
    if p.tj_abort_c <= p.ambient_c:
        raise ValueError("Tj abort threshold must exceed ambient")
    if not p.owner_at_bench:
        raise RcotSafetyError("owner-at-bench acknowledgement is required to start")
    if not p.estop_wired:
        raise RcotSafetyError("E-stop-wired acknowledgement is required to start")


def is_abort(temp_c: float, tj_abort_c: float) -> bool:
    return temp_c > tj_abort_c


def compute_verdict(aborted: bool, manual_pass: Optional[bool]) -> str:
    """A thermal abort is a conclusive FAIL. Otherwise the operator must
    confirm 'no flame, melting, cracking observed' before PASS; until that
    checkbox is set the verdict is UNKNOWN."""
    if aborted:
        return FAIL
    if manual_pass is None:
        return UNKNOWN
    return PASS if manual_pass else FAIL


def synth_temp(t_s: float, p: RcotParams, rng: random.Random) -> float:
    total_s = p.duration_h * 3600.0
    frac = 0.0 if total_s <= 0 else min(1.0, max(0.0, t_s / total_s))
    return p.ambient_c + _PEAK_RISE_C * frac + rng.gauss(0.0, _NOISE_SIGMA_C)


def run_demo(
    p: RcotParams, *, manual_pass: Optional[bool] = None, seed: Optional[int] = None
) -> RcotResult:
    """Synthesise the Tj ramp, logging every log_interval_s and aborting the
    moment synthetic Tj exceeds tj_abort_c."""
    validate_start(p)
    rng = random.Random(seed)
    steps = int((p.duration_h * 3600.0) // p.log_interval_s)
    samples: list[tuple[float, float]] = []
    abort_event: Optional[AbortEvent] = None
    for i in range(steps + 1):
        t = i * p.log_interval_s
        temp = round(synth_temp(t, p, rng), 2)
        samples.append((t, temp))
        logger.debug("RCOT demo t=%.0fs Tj=%.2fC", t, temp)
        if is_abort(temp, p.tj_abort_c):
            abort_event = AbortEvent(t, temp, p.tj_abort_c)
            logger.warning("RCOT ABORT: Tj %.1fC > %.1fC at t=%.0fs", temp, p.tj_abort_c, t)
            break
    peak = max((tp for _, tp in samples), default=p.ambient_c)
    aborted = abort_event is not None
    return RcotResult(aborted, round(peak, 2), compute_verdict(aborted, manual_pass), samples, abort_event)


def run(
    p: RcotParams, *, demo: bool = True, manual_pass: Optional[bool] = None, seed: Optional[int] = None
) -> RcotResult:
    """Dispatch a run. LIVE is hard-blocked — only DEMO synthesis executes."""
    if not demo:
        raise NotImplementedError(LIVE_BLOCKED_MESSAGE)
    return run_demo(p, manual_pass=manual_pass, seed=seed)
