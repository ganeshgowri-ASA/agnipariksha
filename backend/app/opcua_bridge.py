"""Bridge the OPC UA server to a PSU data source (DEMO sim or LIVE PV6000).

Each ``tick`` reads the operator/client setpoints off the OPC UA nodes,
applies them to the source, reads the source back, and publishes fresh
readings to the OPC UA Readings nodes — closing the loop so any UA client
sees its commands reflected.

Two sources share one ``PsuSource`` contract:
  * ``DemoPsuSource`` — first-order simulator: measured V/I track the
    commanded setpoints, power = V·I, temperature rises with delivered
    power and cools toward ambient. Deterministic (no RNG).
  * ``LivePsuSource`` — binds to the real ITECH PV6000 over SCPI. Telemetry
    is always allowed; enabling the output is a physical-safety action and
    is refused unless ``allow_energize`` is explicitly set (mirrors the
    GCT/BDT "no surprise energization" invariant).
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Optional, Protocol

from .opcua_server import PsuOpcUaServer, PsuReadings, PsuSetpoints

AMBIENT_C = 25.0


class PsuSource(Protocol):
    def apply(self, sp: PsuSetpoints) -> None: ...
    def read(self) -> PsuReadings: ...


@dataclass
class DemoPsuSource:
    """First-order DC-PSU simulator. ``response`` is the per-tick fraction
    the measured value moves toward its target (0..1)."""

    response: float = 0.35
    thermal_gain: float = 0.02  # °C rise per watt per tick
    cooling: float = 0.05  # fraction per tick toward ambient
    v: float = 0.0
    i: float = 0.0
    temp_c: float = AMBIENT_C
    _sp: PsuSetpoints = field(default_factory=PsuSetpoints)

    def apply(self, sp: PsuSetpoints) -> None:
        self._sp = sp

    def read(self) -> PsuReadings:
        target_v = self._sp.voltage_v if self._sp.output_enabled else 0.0
        target_i = self._sp.current_a if self._sp.output_enabled else 0.0
        self.v += (target_v - self.v) * self.response
        self.i += (target_i - self.i) * self.response
        power = self.v * self.i
        self.temp_c += self.thermal_gain * power - self.cooling * (self.temp_c - AMBIENT_C)
        return PsuReadings(
            voltage_v=round(self.v, 4),
            current_a=round(self.i, 4),
            power_w=round(power, 4),
            temperature_c=round(self.temp_c, 3),
        )


class LivePsuSource:
    """Binds the bridge to the real PV6000 over an SCPIDriver-like object."""

    def __init__(self, driver: Any, *, allow_energize: bool = False) -> None:
        self._drv = driver
        self.allow_energize = allow_energize
        self._output = False

    def apply(self, sp: PsuSetpoints) -> None:
        self._drv.set_voltage(sp.voltage_v)
        self._drv.set_current(sp.current_a)
        if sp.output_enabled and not self.allow_energize:
            raise PermissionError(
                "Refusing to energize PV6000 output: allow_energize is False "
                "(owner-at-bench + E-stop confirmation required)"
            )
        if sp.output_enabled and not self._output:
            self._drv.output_on()
            self._output = True
        elif not sp.output_enabled and self._output:
            self._drv.output_off()
            self._output = False

    def read(self) -> PsuReadings:
        m = self._drv.measure_all()
        return PsuReadings(
            voltage_v=float(m["voltage"]),
            current_a=float(m["current"]),
            power_w=float(m["power"]),
            temperature_c=float("nan"),  # PV6000 has no junction-temp sensor
        )


def make_source(demo: bool, *, driver: Any = None, allow_energize: bool = False) -> PsuSource:
    """DEMO_MODE → simulator; else bind to the live PV6000 SCPI driver."""
    if demo:
        return DemoPsuSource()
    if driver is None:
        from ..scpi_driver import SCPIDriver  # lazy: avoids socket import in DEMO

        driver = SCPIDriver()
    return LivePsuSource(driver, allow_energize=allow_energize)


class PsuOpcUaBridge:
    """Pumps setpoints→source→readings between the OPC UA server and a source."""

    def __init__(self, server: PsuOpcUaServer, source: PsuSource) -> None:
        self.server = server
        self.source = source

    async def tick(self) -> PsuReadings:
        sp = await self.server.get_setpoints()
        self.source.apply(sp)
        readings = self.source.read()
        await self.server.update_readings(readings)
        return readings

    async def run(self, interval_s: float = 0.5, *, stop: Optional[asyncio.Event] = None) -> None:
        while stop is None or not stop.is_set():
            await self.tick()
            await asyncio.sleep(interval_s)
