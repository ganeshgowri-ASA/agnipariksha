"""Abstract EL camera + DEMO-only simulator.

The real cooled-CCD/CMOS SDK is intentionally not imported here.
``SimulatedELCamera`` synthesises a gradient frame with a diagonal
"crack" line so the UI can be developed before hardware arrives.
"""
from __future__ import annotations

from abc import ABC, abstractmethod

import numpy as np

DEFAULT_HEIGHT = 64
DEFAULT_WIDTH = 96


class ELCamera(ABC):
    @abstractmethod
    def set_exposure_ms(self, exposure_ms: int) -> None: ...
    @abstractmethod
    def set_gain(self, gain: float) -> None: ...
    @abstractmethod
    def capture(self) -> np.ndarray: ...


class SimulatedELCamera(ELCamera):
    """DEMO-only camera; raises in live mode so misconfig is loud."""

    def __init__(self, *, demo_mode: bool,
                 height: int = DEFAULT_HEIGHT, width: int = DEFAULT_WIDTH) -> None:
        if not demo_mode:
            raise NotImplementedError(
                "SimulatedELCamera only supported in DEMO_MODE; "
                "real EL camera SDK not yet integrated."
            )
        self._h, self._w = height, width
        self._exposure_ms = 500
        self._gain = 1.0

    def set_exposure_ms(self, exposure_ms: int) -> None:
        if not isinstance(exposure_ms, int) or exposure_ms <= 0:
            raise ValueError("exposure_ms must be a positive integer")
        self._exposure_ms = exposure_ms

    def set_gain(self, gain: float) -> None:
        if gain <= 0:
            raise ValueError("gain must be > 0")
        self._gain = float(gain)

    def capture(self) -> np.ndarray:
        col = np.linspace(2000, 60000, self._w, dtype=np.float32)
        frame = np.tile(col, (self._h, 1))
        frame *= min(1.0, (self._exposure_ms / 1000.0) * self._gain)
        # Synthetic crack: diagonal dark line.
        for i in range(min(self._h, self._w)):
            frame[i % self._h, i % self._w] = 0
        return frame.astype(np.uint16)
