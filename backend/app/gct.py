"""Ground Continuity Test (GCT) — IEC 61730-2 MST 13.

Measures grounding-path resistance using 4-wire (Kelvin) sensing on a
Keysight 34465A bench DMM. The DMM provides its own test current via
the front-panel HI/LO sense leads, so the ITECH PV6000 power supply
output remains OFF for the entire test — GCT is a DMM-only flow.

Pass criterion: R < ``max_resistance`` (default 0.1 Ω per IEC 61730-2).

SCPI configured on the 34465A:
    CONF:FRES <range>     - 4-wire resistance mode, auto-range by default
    FRES:NPLC 10          - integrate over 10 power-line cycles for noise rejection
    TRIG:SOUR IMM         - immediate trigger
    READ?                 - one-shot measurement, returns ohms as ASCII float

Demo mode produces a plausible reading centered around 0.03 Ω with small
Gaussian noise — well under the 0.1 Ω limit so the simulator default is a
"PASS" outcome (matching a healthy module under test).
"""
from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass
from typing import Any, AsyncIterator, Optional


# IEC 61730-2 MST 13 — accessible-to-ground continuity pass threshold.
DEFAULT_MAX_RESISTANCE_OHM = 0.1

# Default range for 34465A 4-wire R: 100 Ω covers the < 1 Ω regime with
# resolution well below the 0.1 Ω pass threshold.
DEFAULT_RANGE = "100"

# Demo simulator: a healthy bond is typically a few mΩ to tens of mΩ.
_DEMO_R_MEAN = 0.030
_DEMO_R_SIGMA = 0.004


@dataclass
class GctReading:
    """One DMM 4-wire resistance sample plus pass/fail verdict."""

    timestamp: int  # ms since epoch
    resistance: float  # ohms
    passed: bool
    max_resistance: float
    source: str  # "dmm_keysight" | "sim"
    demo: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "gct_reading",
            "timestamp": self.timestamp,
            "ts": self.timestamp,
            "resistance": round(self.resistance, 6),
            "R": round(self.resistance, 6),
            "pass": self.passed,
            "passed": self.passed,
            "max_resistance": self.max_resistance,
            "source": self.source,
            "demo": self.demo,
        }


def evaluate_pass(resistance: float, max_resistance: float = DEFAULT_MAX_RESISTANCE_OHM) -> bool:
    """Strictly less-than per IEC 61730-2 (the standard expresses the limit
    as an inclusive ceiling; using ``<`` here gives an extra noise margin
    and matches the GCT tab's existing UI copy)."""
    if max_resistance <= 0:
        return False
    return resistance < max_resistance


class GctSimulator:
    """Deterministic-ish synthetic 4-wire R readings for demo mode."""

    def __init__(self, mean: float = _DEMO_R_MEAN, sigma: float = _DEMO_R_SIGMA) -> None:
        self._mean = mean
        self._sigma = sigma

    def sample(self) -> float:
        # Clamp to a positive resistance so V/I math elsewhere stays sane.
        return max(0.0, random.gauss(self._mean, self._sigma))


class KeysightDmmGct:
    """4-wire ground-continuity controller for the Keysight 34465A.

    Wraps an optional transport (``ScpiUsbtmcTransport`` or any
    :class:`backend.app.transports.Transport`). When ``demo`` is True
    or no transport is supplied, falls back to :class:`GctSimulator`.

    The class **never** touches the ITECH PV6000 — by construction it
    cannot enable the PSU output. The router layer additionally sends an
    explicit ``OUTP OFF`` to the PSU before each GCT run as belt-and-braces.
    """

    def __init__(
        self,
        transport: Optional[Any] = None,
        *,
        demo: bool = True,
        max_resistance: float = DEFAULT_MAX_RESISTANCE_OHM,
        range_str: str = DEFAULT_RANGE,
        nplc: int = 10,
    ) -> None:
        self._transport = transport
        self._demo = demo or transport is None
        self._max_r = max_resistance
        self._range = range_str
        self._nplc = nplc
        self._configured = False
        self._sim = GctSimulator()

    @property
    def demo(self) -> bool:
        return self._demo

    @property
    def max_resistance(self) -> float:
        return self._max_r

    def set_max_resistance(self, value: float) -> None:
        # Defensive clamp: a non-positive limit would silently mark every
        # reading as FAIL — surface as a runtime error instead.
        if value <= 0:
            raise ValueError("max_resistance must be > 0 Ω")
        self._max_r = value

    async def configure_4wire(self) -> None:
        """Put the DMM in 4-wire resistance mode with sensible defaults.

        Idempotent: a second call simply re-issues the configuration
        commands. In demo mode this is a no-op.
        """
        if self._demo or self._transport is None:
            self._configured = True
            return
        await self._transport.send(f"CONF:FRES {self._range}")
        await self._transport.send(f"FRES:NPLC {self._nplc}")
        await self._transport.send("TRIG:SOUR IMM")
        self._configured = True

    async def read_resistance(self) -> float:
        """Single 4-wire resistance measurement, returns ohms.

        Raises whatever the transport raises in live mode — callers
        translate that to the HTTP / WebSocket error contract.
        """
        if self._demo or self._transport is None:
            return self._sim.sample()
        if not self._configured:
            await self.configure_4wire()
        raw = await self._transport.query("READ?")
        try:
            return float(raw)
        except ValueError as exc:
            raise RuntimeError(f"DMM returned non-numeric reading: {raw!r}") from exc

    async def measure(self) -> GctReading:
        r = await self.read_resistance()
        return GctReading(
            timestamp=int(time.time() * 1000),
            resistance=r,
            passed=evaluate_pass(r, self._max_r),
            max_resistance=self._max_r,
            source="sim" if self._demo else "dmm_keysight",
            demo=self._demo,
        )

    async def stream(self, interval_s: float = 0.5) -> AsyncIterator[GctReading]:
        """Continuous reading stream — used by the live WebSocket."""
        while True:
            yield await self.measure()
            await asyncio.sleep(interval_s)
