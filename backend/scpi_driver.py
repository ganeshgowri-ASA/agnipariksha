"""Async SCPI driver for ITECH PV6000 over raw TCP.

Implements an asyncio-based client using ITECH's raw TCP SCPI socket
service (default port 30000). Supports auto-reconnect, per-call timeouts,
and helpers for output control, measurement, OVP/OCP/OPP/UVP/UCP
protections, solar-array simulator (SAS) curve programming, arbitrary
waveform user-table download, and LIST mode program download.

Environment overrides:
    ITECH_DEVICE_IP   -- override default IP (192.168.200.100)
    ITECH_DEVICE_PORT -- override default port (30000)
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Iterable, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

DEFAULT_IP = os.environ.get("ITECH_DEVICE_IP", "192.168.200.100")
DEFAULT_PORT = int(os.environ.get("ITECH_DEVICE_PORT", "30000"))

DEFAULT_TIMEOUT = 5.0
DEFAULT_CONNECT_TIMEOUT = 5.0
DEFAULT_RECONNECT_DELAY = 1.0
DEFAULT_MAX_RECONNECT_ATTEMPTS = 3
TERMINATOR = "\n"


class SCPIError(Exception):
    """Base class for SCPI driver errors."""


class SCPIConnectionError(SCPIError):
    """Raised when the underlying TCP connection cannot be established or
    has been lost and could not be recovered."""


class SCPITimeoutError(SCPIError):
    """Raised when a SCPI read/write does not complete within the timeout."""


class AsyncSCPIDriver:
    """Asyncio TCP SCPI client for the ITECH PV6000 series.

    All write/query helpers are coroutines. The driver serializes access
    via an internal lock so concurrent callers cannot interleave SCPI
    frames on the wire.
    """

    def __init__(
        self,
        ip: str = DEFAULT_IP,
        port: int = DEFAULT_PORT,
        timeout: float = DEFAULT_TIMEOUT,
        connect_timeout: float = DEFAULT_CONNECT_TIMEOUT,
        reconnect_delay: float = DEFAULT_RECONNECT_DELAY,
        max_reconnect_attempts: int = DEFAULT_MAX_RECONNECT_ATTEMPTS,
        auto_reconnect: bool = True,
    ) -> None:
        self.ip = ip
        self.port = port
        self.timeout = timeout
        self.connect_timeout = connect_timeout
        self.reconnect_delay = reconnect_delay
        self.max_reconnect_attempts = max_reconnect_attempts
        self.auto_reconnect = auto_reconnect

        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------
    @property
    def connected(self) -> bool:
        return self._writer is not None and not self._writer.is_closing()

    async def connect(self) -> None:
        if self.connected:
            return
        try:
            self._reader, self._writer = await asyncio.wait_for(
                asyncio.open_connection(self.ip, self.port),
                timeout=self.connect_timeout,
            )
        except asyncio.TimeoutError as exc:
            raise SCPIConnectionError(
                f"Timed out connecting to {self.ip}:{self.port}"
            ) from exc
        except OSError as exc:
            raise SCPIConnectionError(
                f"Failed to connect to {self.ip}:{self.port}: {exc}"
            ) from exc
        logger.info("SCPI connected to %s:%s", self.ip, self.port)

    async def disconnect(self) -> None:
        writer = self._writer
        self._reader = None
        self._writer = None
        if writer is None:
            return
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:  # noqa: BLE001 -- best-effort close
            logger.debug("Error during SCPI disconnect", exc_info=True)

    async def _ensure_connected(self) -> None:
        if self.connected:
            return
        if not self.auto_reconnect:
            raise SCPIConnectionError("Not connected and auto_reconnect=False")
        last_exc: Optional[Exception] = None
        for attempt in range(1, self.max_reconnect_attempts + 1):
            try:
                await self.connect()
                return
            except SCPIConnectionError as exc:
                last_exc = exc
                logger.warning(
                    "Reconnect attempt %d/%d failed: %s",
                    attempt,
                    self.max_reconnect_attempts,
                    exc,
                )
                await asyncio.sleep(self.reconnect_delay * attempt)
        raise SCPIConnectionError(
            f"Could not reconnect after {self.max_reconnect_attempts} attempts"
        ) from last_exc

    async def __aenter__(self) -> "AsyncSCPIDriver":
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.disconnect()

    # ------------------------------------------------------------------
    # Low-level I/O
    # ------------------------------------------------------------------
    async def write(self, command: str) -> None:
        """Send a SCPI command (no response expected)."""
        async with self._lock:
            await self._write_locked(command)

    async def _write_locked(self, command: str) -> None:
        await self._ensure_connected()
        assert self._writer is not None
        payload = (command.rstrip("\r\n") + TERMINATOR).encode("ascii")
        try:
            self._writer.write(payload)
            await asyncio.wait_for(self._writer.drain(), timeout=self.timeout)
        except asyncio.TimeoutError as exc:
            raise SCPITimeoutError(
                f"Timed out writing SCPI command: {command!r}"
            ) from exc
        except (OSError, ConnectionError) as exc:
            await self.disconnect()
            raise SCPIConnectionError(f"Write failed: {exc}") from exc

    async def query(self, command: str) -> str:
        """Send a SCPI query and return the stripped response line."""
        async with self._lock:
            await self._write_locked(command)
            assert self._reader is not None
            try:
                line = await asyncio.wait_for(
                    self._reader.readline(), timeout=self.timeout
                )
            except asyncio.TimeoutError as exc:
                raise SCPITimeoutError(
                    f"Timed out reading response to {command!r}"
                ) from exc
            except (OSError, ConnectionError) as exc:
                await self.disconnect()
                raise SCPIConnectionError(f"Read failed: {exc}") from exc
        if not line:
            raise SCPIConnectionError(
                f"Connection closed while reading response to {command!r}"
            )
        return line.decode("ascii", errors="replace").strip()

    async def query_float(self, command: str) -> float:
        return float(await self.query(command))

    # ------------------------------------------------------------------
    # Basic identity / output / setpoints
    # ------------------------------------------------------------------
    async def idn(self) -> str:
        return await self.query("*IDN?")

    async def reset(self) -> None:
        await self.write("*RST")

    async def output(self, on: bool) -> None:
        await self.write(f"OUTPut {'ON' if on else 'OFF'}")

    async def set_volt(self, v: float) -> None:
        await self.write(f"SOURce:VOLTage {float(v):.4f}")

    async def set_curr(self, i: float) -> None:
        await self.write(f"SOURce:CURRent {float(i):.4f}")

    # ------------------------------------------------------------------
    # Measurements
    # ------------------------------------------------------------------
    async def meas_v(self) -> float:
        return await self.query_float("MEASure:VOLTage?")

    async def meas_i(self) -> float:
        return await self.query_float("MEASure:CURRent?")

    async def meas_p(self) -> float:
        return await self.query_float("MEASure:POWer?")

    # ------------------------------------------------------------------
    # Protections (OVP / OCP / OPP / UVP / UCP)
    # ------------------------------------------------------------------
    async def set_ovp(self, level: float, delay: float = 0.0) -> None:
        await self.write(f"SOURce:VOLTage:PROTection:LEVel {float(level):.4f}")
        await self.write(f"SOURce:VOLTage:PROTection:DELay {float(delay):.4f}")
        await self.write("SOURce:VOLTage:PROTection:STATe ON")

    async def set_ocp(self, level: float, delay: float = 0.0) -> None:
        await self.write(f"SOURce:CURRent:PROTection:LEVel {float(level):.4f}")
        await self.write(f"SOURce:CURRent:PROTection:DELay {float(delay):.4f}")
        await self.write("SOURce:CURRent:PROTection:STATe ON")

    async def set_opp(self, level: float, delay: float = 0.0) -> None:
        await self.write(f"SOURce:POWer:PROTection:LEVel {float(level):.4f}")
        await self.write(f"SOURce:POWer:PROTection:DELay {float(delay):.4f}")
        await self.write("SOURce:POWer:PROTection:STATe ON")

    async def set_uvp(self, level: float, delay: float = 0.0) -> None:
        await self.write(f"SOURce:VOLTage:LIMit:LOW {float(level):.4f}")
        await self.write(f"SOURce:VOLTage:LIMit:LOW:DELay {float(delay):.4f}")
        await self.write("SOURce:VOLTage:LIMit:LOW:STATe ON")

    async def set_ucp(self, level: float, delay: float = 0.0) -> None:
        await self.write(f"SOURce:CURRent:LIMit:LOW {float(level):.4f}")
        await self.write(f"SOURce:CURRent:LIMit:LOW:DELay {float(delay):.4f}")
        await self.write("SOURce:CURRent:LIMit:LOW:STATe ON")

    async def clear_protect(self) -> None:
        """Clear all latched protection conditions."""
        await self.write("SOURce:PROTection:CLEar")

    async def prot_status(self) -> int:
        """Return the questionable-condition register as an int.

        Bits indicate which protection has tripped (OVP, OCP, OPP, OTP,
        UVP, UCP, etc.). Refer to the ITECH programming manual for the
        bit map.
        """
        return int(await self.query("STATus:QUEStionable:CONDition?"))

    # ------------------------------------------------------------------
    # Solar Array Simulator
    # ------------------------------------------------------------------
    async def set_sas(
        self, voc: float, vmp: float, isc: float, imp: float
    ) -> None:
        """Program the SAS I-V curve from Voc/Vmp/Isc/Imp.

        Uses the SCPI SAS subsystem (PV simulator mode) and switches the
        instrument into SAS function before writing the four parameters.
        """
        if not (0 < vmp < voc):
            raise ValueError("Require 0 < vmp < voc")
        if not (0 < imp < isc):
            raise ValueError("Require 0 < imp < isc")
        await self.write("SOURce:FUNCtion SAS")
        await self.write(f"SOURce:SAS:VOC {float(voc):.4f}")
        await self.write(f"SOURce:SAS:VMP {float(vmp):.4f}")
        await self.write(f"SOURce:SAS:ISC {float(isc):.4f}")
        await self.write(f"SOURce:SAS:IMP {float(imp):.4f}")
        await self.write("SOURce:SAS:CURVe:UPDate")

    # ------------------------------------------------------------------
    # Arbitrary waveform / user table
    # ------------------------------------------------------------------
    async def download_arb_user(
        self, points: Sequence[Tuple[float, float]]
    ) -> None:
        """Download a user (V, I) curve table to the SAS USER memory.

        Each point is a (voltage, current) tuple. The point count is
        sent first, followed by a comma-separated list of values in
        ``v0,i0,v1,i1,...`` order.
        """
        pts = list(points)
        if not pts:
            raise ValueError("download_arb_user requires at least one point")
        if len(pts) > 4096:
            raise ValueError("Maximum 4096 points supported by USER table")
        await self.write("SOURce:FUNCtion SAS")
        await self.write("SOURce:SAS:CURVe:TABLe USER")
        await self.write(f"SOURce:SAS:CURVe:TABLe:POINts {len(pts)}")
        flat = ",".join(f"{float(v):.4f},{float(i):.4f}" for v, i in pts)
        await self.write(f"SOURce:SAS:CURVe:TABLe:DATA {flat}")
        await self.write("SOURce:SAS:CURVe:UPDate")

    # ------------------------------------------------------------------
    # LIST mode program download
    # ------------------------------------------------------------------
    async def download_program(self, steps: Iterable[dict]) -> None:
        """Download a multi-step program into LIST memory.

        Each ``step`` dict may contain keys: ``voltage``, ``current``,
        ``dwell`` (seconds). Missing keys are skipped for that step.
        Steps are written as parallel comma-separated lists, which is
        the standard SCPI LIST subsystem convention.
        """
        steps = list(steps)
        if not steps:
            raise ValueError("download_program requires at least one step")
        await self.write("SOURce:LIST:CLEar")
        await self.write(f"SOURce:LIST:COUNt {len(steps)}")

        volts = [s.get("voltage") for s in steps]
        currs = [s.get("current") for s in steps]
        dwells = [s.get("dwell") for s in steps]

        if all(v is not None for v in volts):
            await self.write(
                "SOURce:LIST:VOLTage "
                + ",".join(f"{float(v):.4f}" for v in volts)
            )
        if all(c is not None for c in currs):
            await self.write(
                "SOURce:LIST:CURRent "
                + ",".join(f"{float(c):.4f}" for c in currs)
            )
        if all(d is not None for d in dwells):
            await self.write(
                "SOURce:LIST:DWELl "
                + ",".join(f"{float(d):.4f}" for d in dwells)
            )
        await self.write("SOURce:FUNCtion:MODE LIST")


# Backwards-compat alias used elsewhere in the project.
SCPIDriver = AsyncSCPIDriver

__all__ = [
    "AsyncSCPIDriver",
    "SCPIDriver",
    "SCPIError",
    "SCPIConnectionError",
    "SCPITimeoutError",
    "DEFAULT_IP",
    "DEFAULT_PORT",
]
