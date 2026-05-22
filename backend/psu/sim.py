"""Simulated PSU driver - no socket I/O, purely in-process.

Used by DEMO_MODE so the UI/tests can exercise the full PSU code path
without any hardware attached. The IDN string deliberately advertises
``SIM,PSU,DEMO,1.0`` so log scrapers can tell sim data from real.
"""
from __future__ import annotations

import random

from .base import PSUDriver
from .registry import register_driver


class SimulatedPSUDriver(PSUDriver):
    """In-process PSU stand-in. Stores setpoints, returns noisy measurements."""

    make = "sim"
    model = "DEMO"

    # Noise amplitudes are small enough that callers asserting "approx
    # setpoint" stay deterministic without seeding the RNG.
    _NOISE_V = 0.01
    _NOISE_I = 0.005

    def __init__(self, host: str = "", port: int = 0) -> None:
        self.host = host
        self.port = port
        self._connected: bool = False
        self._output: bool = False
        self._v_setpoint: float = 0.0
        self._i_setpoint: float = 0.0

    # --- Connection lifecycle ----------------------------------------
    def connect(self) -> str:
        self._connected = True
        return self.idn()

    def disconnect(self) -> None:
        self._connected = False
        self._output = False

    # --- Identification ----------------------------------------------
    def idn(self) -> str:
        return "SIM,PSU,DEMO,1.0"

    # --- Output control ----------------------------------------------
    def output_on(self) -> None:
        self._output = True

    def output_off(self) -> None:
        self._output = False

    # --- Setpoints ---------------------------------------------------
    def set_voltage(self, v: float) -> None:
        self._v_setpoint = float(v)

    def set_current(self, i: float) -> None:
        self._i_setpoint = float(i)

    # --- Measurements ------------------------------------------------
    def measure_voltage(self) -> float:
        if not self._output:
            return 0.0
        return self._v_setpoint + random.gauss(0.0, self._NOISE_V)

    def measure_current(self) -> float:
        if not self._output:
            return 0.0
        return self._i_setpoint + random.gauss(0.0, self._NOISE_I)

    def measure_power(self) -> float:
        v = self.measure_voltage()
        i = self.measure_current()
        return v * i


register_driver("sim", SimulatedPSUDriver)
