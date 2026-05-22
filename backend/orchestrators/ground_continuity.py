"""Ground Continuity Test (GCT) orchestrator — IEC 61730-2 §5.3.2.

Apply ``max(25 A, 2 * Isc)`` between any accessible conductive part and
the module's grounding provision for 2 min; the measured DC resistance
must be < 0.1 Ω.

State machine: IDLE -> APPLYING_CURRENT -> MEASURING -> COMPLETE.
DEMO_MODE-only (``assert`` at construction). Live PSU energization
is gated by ``# TODO(PR#52a/b)`` markers — the safety basic-check lands
in PR#52a/b.
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional

try:
    from ..config import get_settings
except ImportError:  # pragma: no cover - script-mode fallback
    from config import get_settings  # type: ignore[no-redef]


# Constants from IEC 61730-2 §5.3.2
DEFAULT_TEST_CURRENT_A: float = 25.0
DEFAULT_DURATION_S: int = 120  # 2 minutes
DEFAULT_R_LIMIT_OHM: float = 0.1
SAMPLES_PER_TEST: int = 12  # one sample every ~10 s during MEASURING


class GCTState(str, Enum):
    IDLE = "IDLE"
    APPLYING_CURRENT = "APPLYING_CURRENT"
    MEASURING = "MEASURING"
    COMPLETE = "COMPLETE"


@dataclass
class GCTSample:
    """A single V/I/R sample captured during MEASURING."""

    t_s: float
    voltage_v: float
    current_a: float
    resistance_ohm: float

    def to_dict(self) -> dict:
        return {
            "t_s": round(self.t_s, 3),
            "voltage_v": round(self.voltage_v, 6),
            "current_a": round(self.current_a, 4),
            "resistance_ohm": round(self.resistance_ohm, 6),
        }


@dataclass
class GroundContinuityOrchestrator:
    """IEC 61730-2 §5.3.2 Ground Continuity orchestrator (DEMO_MODE only).

    Applies ``max(test_current_a, 2 * isc_a)`` for ``duration_s`` seconds
    and asserts the measured DC bond resistance is < ``r_limit_ohm``.
    """

    module_id: str
    isc_a: float
    test_current_a: float = DEFAULT_TEST_CURRENT_A
    duration_s: int = DEFAULT_DURATION_S
    r_limit_ohm: float = DEFAULT_R_LIMIT_OHM
    seed: Optional[int] = None

    state: GCTState = field(default=GCTState.IDLE, init=False)
    applied_current_a: float = field(default=0.0, init=False)
    samples: List[GCTSample] = field(default_factory=list, init=False)
    measured_resistance_ohm: Optional[float] = field(default=None, init=False)
    passed: Optional[bool] = field(default=None, init=False)
    _rng: random.Random = field(init=False, repr=False)

    def __post_init__(self) -> None:
        # DEMO_MODE only — see module docstring + TODO marker below.
        # The real live-mode dispatch is gated on the safety basic-check
        # which is owned by PR#52a/b.
        settings = get_settings()
        assert settings.DEMO_MODE, (
            "GroundContinuityOrchestrator is DEMO_MODE only until the safety "
            "basic-check lands in PR#52a/b."
        )
        if self.isc_a < 0:
            raise ValueError("isc_a must be non-negative")
        if self.test_current_a <= 0:
            raise ValueError("test_current_a must be > 0")
        if self.duration_s <= 0:
            raise ValueError("duration_s must be > 0")
        if self.r_limit_ohm <= 0:
            raise ValueError("r_limit_ohm must be > 0")
        # IEC 61730-2 §5.3.2: I_test = max(25 A, 2 * Isc).
        self.applied_current_a = max(self.test_current_a, 2.0 * self.isc_a)
        self._rng = random.Random(self.seed if self.seed is not None else 0xA61730)

    # State transitions ----------------------------------------------

    def start(self) -> None:
        """IDLE -> APPLYING_CURRENT. Idempotent until COMPLETE."""
        if self.state != GCTState.IDLE:
            raise RuntimeError(f"start() requires IDLE, got {self.state}")
        # TODO(PR#52a/b): replace with real PSU energization once the
        # safety basic-check / interlock has approved the run. Today this
        # is a state flip only; no SCPI traffic.
        self.state = GCTState.APPLYING_CURRENT

    def begin_measuring(self) -> None:
        """APPLYING_CURRENT -> MEASURING (current has settled)."""
        if self.state != GCTState.APPLYING_CURRENT:
            raise RuntimeError(
                f"begin_measuring() requires APPLYING_CURRENT, got {self.state}"
            )
        self.state = GCTState.MEASURING

    def sample(self, t_s: float, *, fault_ohm: Optional[float] = None) -> GCTSample:
        """Append one synthetic V/I/R sample. Must be in MEASURING.

        ``fault_ohm`` lets tests force a high-resistance scenario.
        """
        if self.state != GCTState.MEASURING:
            raise RuntimeError(f"sample() requires MEASURING, got {self.state}")
        # Healthy bond ~ 30 mΩ ± 5 mΩ (Gaussian); fault paths are forced.
        if fault_ohm is not None:
            r = float(fault_ohm)
        else:
            r = max(0.0, self._rng.gauss(0.03, 0.005))
        # Current ripples slightly around the applied setpoint.
        i = max(0.1, self._rng.gauss(self.applied_current_a, 0.05))
        v = r * i
        s = GCTSample(t_s=t_s, voltage_v=v, current_a=i, resistance_ohm=r)
        self.samples.append(s)
        return s

    def complete(self) -> bool:
        """MEASURING -> COMPLETE. Computes pass/fail. Returns ``passed``."""
        if self.state != GCTState.MEASURING:
            raise RuntimeError(f"complete() requires MEASURING, got {self.state}")
        if not self.samples:
            raise RuntimeError("complete() called with zero samples")
        # Report the worst-case (highest) resistance — most conservative
        # for pass/fail per IEC 61730-2 §5.3.2.
        worst = max(s.resistance_ohm for s in self.samples)
        self.measured_resistance_ohm = worst
        self.passed = worst < self.r_limit_ohm
        self.state = GCTState.COMPLETE
        return self.passed

    # End-to-end demo run ---------------------------------------------

    def run_demo(self, *, fault_ohm: Optional[float] = None) -> dict:
        """Drive the full IDLE -> COMPLETE sequence with simulated samples."""
        self.start()
        self.begin_measuring()
        dt = self.duration_s / SAMPLES_PER_TEST
        for i in range(SAMPLES_PER_TEST):
            self.sample(t_s=(i + 1) * dt, fault_ohm=fault_ohm)
        self.complete()
        return self.to_dict()

    # Serialization ----------------------------------------------------

    def to_dict(self) -> dict:
        return {
            "standard": "IEC 61730-2 §5.3.2",
            "test": "GroundContinuity",
            "module_id": self.module_id,
            "state": self.state.value,
            "params": {
                "isc_a": self.isc_a,
                "test_current_a": self.test_current_a,
                "applied_current_a": round(self.applied_current_a, 4),
                "duration_s": self.duration_s,
                "r_limit_ohm": self.r_limit_ohm,
            },
            "measured_resistance_ohm": (
                round(self.measured_resistance_ohm, 6)
                if self.measured_resistance_ohm is not None
                else None
            ),
            "passed": self.passed,
            "samples": [s.to_dict() for s in self.samples],
        }
