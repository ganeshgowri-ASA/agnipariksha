"""TestSimulator - wraps an orchestrator and emits synthetic V/I/T/G.

Intentionally lightweight: no real physics, just values pulled from the
orchestrator each tick. The frontend gets deterministic traces for
charting in DEMO_MODE without needing the PSU.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


class _OrchestratorLike(Protocol):
    temp_c: float
    def tick(self, now_s: float): ...
    def current_a(self) -> float: ...
    def to_dict(self) -> dict: ...


@dataclass
class TestSimulator:
    """Wrap an orchestrator and emit a sample per ``sample(now_s)``."""

    orchestrator: _OrchestratorLike
    irradiance_w_m2: float = 1000.0   # STC; placeholder for light-soak
    compliance_v: float = 0.5         # matches scpi_driver default
    _samples_emitted: int = field(default=0, init=False)

    def sample(self, now_s: float) -> dict:
        self.orchestrator.tick(now_s)
        out = {
            "t_s": now_s,
            "voltage_v": self.compliance_v,
            "current_a": round(self.orchestrator.current_a(), 4),
            "temp_c": round(self.orchestrator.temp_c, 2),
            "irradiance_w_m2": self.irradiance_w_m2,
            "orchestrator": self.orchestrator.to_dict(),
        }
        self._samples_emitted += 1
        return out

    @property
    def samples_emitted(self) -> int:
        return self._samples_emitted
