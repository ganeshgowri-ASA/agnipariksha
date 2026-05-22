"""Abstract base class for PSU drivers.

Vendor drivers (ITech, Chroma, Keysight, ...) subclass :class:`PSUDriver`
and implement the abstract methods. The ABC stays minimal - only the
operations every IEC test in this codebase needs at runtime are
abstract; vendor extras (programs, OVP/OCP, ...) live on subclasses.
"""
from __future__ import annotations

import abc


class PSUDriver(abc.ABC):
    """Vendor-neutral programmable PSU contract.

    Subclasses open/close the transport (TCP, VISA, USBTMC, ...) and
    translate abstract calls into vendor SCPI.

    Attributes
    ----------
    make : str   - vendor key, e.g. "itech", "sim".
    model : str  - model identifier, e.g. "PV6000", "DEMO".
    host : str   - network host ("" for non-network transports).
    port : int   - network port (0 for non-network transports).
    """

    make: str = ""
    model: str = ""
    host: str = ""
    port: int = 0

    # Connection lifecycle ---------------------------------------------
    @abc.abstractmethod
    def connect(self) -> str:
        """Open the transport. Returns the ``*IDN?`` response."""

    @abc.abstractmethod
    def disconnect(self) -> None:
        """Close the transport. Safe to call when already disconnected."""

    # Identification ---------------------------------------------------
    @abc.abstractmethod
    def idn(self) -> str:
        """Return the standard ``*IDN?`` response string."""

    # Output control ---------------------------------------------------
    @abc.abstractmethod
    def output_on(self) -> None:
        """Enable the DC output."""

    @abc.abstractmethod
    def output_off(self) -> None:
        """Disable the DC output."""

    # Setpoints --------------------------------------------------------
    @abc.abstractmethod
    def set_voltage(self, v: float) -> None:
        """Program the voltage setpoint (V)."""

    @abc.abstractmethod
    def set_current(self, i: float) -> None:
        """Program the current setpoint (A)."""

    # Measurements -----------------------------------------------------
    @abc.abstractmethod
    def measure_voltage(self) -> float:
        """Return measured output voltage (V)."""

    @abc.abstractmethod
    def measure_current(self) -> float:
        """Return measured output current (A)."""

    @abc.abstractmethod
    def measure_power(self) -> float:
        """Return measured output power (W)."""
