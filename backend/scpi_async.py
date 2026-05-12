"""Async ITECH PV6000 driver + demo-mode simulator.

This module is the runtime path used by the FastAPI WebSocket telemetry
loop. The legacy synchronous ``scpi_driver.SCPIDriver`` is kept for
scripts and one-off CLI usage; everything new should target the async
``ScpiClient`` here.

Design notes
------------
- One asyncio ``Lock`` per client serializes command/query pairs over
  the single TCP socket (the ITECH only accepts one in-flight query).
- A bounded outbound command queue lets fast producers (e.g. the WS
  control bar) push fire-and-forget commands without blocking.
- ``connect`` retries with capped exponential back-off, then yields
  to the simulator if hardware is unreachable and DEMO_MODE is on.
- The simulator emits physically plausible curves for each IEC test.
"""
from __future__ import annotations

import asyncio
import math
import random
import socket
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import AsyncIterator, Awaitable, Callable, Optional

try:
    from .config import get_settings  # package-mode (backend.scpi_async)
except ImportError:  # script-mode (uvicorn main:app from inside backend/)
    from config import get_settings  # type: ignore[no-redef]


@dataclass
class Reading:
    timestamp: int  # ms
    voltage: float
    current: float
    power: float
    temperature: float
    test_id: str = ""
    mqt: str = ""

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp,
            "ts": self.timestamp,
            "voltage": self.voltage,
            "V": self.voltage,
            "current": self.current,
            "I": self.current,
            "power": self.power,
            "P": self.power,
            "temperature": self.temperature,
            "T": self.temperature,
            "test_id": self.test_id,
            "mqt": self.mqt,
        }


def is_scpi_reachable(host: str, port: int, timeout_ms: int = 500) -> bool:
    """Synchronous TCP probe used by the /api/health deep-check.

    Kept synchronous so it can be called from non-async code paths
    (e.g. unit tests, the health endpoint's thread executor).
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout_ms / 1000.0)
    try:
        sock.connect((host, port))
        return True
    except (OSError, socket.timeout):
        return False
    finally:
        sock.close()


class ScpiClient:
    """Async TCP SCPI client for the ITECH PV6000.

    Falls back to ``DemoSimulator`` when DEMO_MODE is on or the device
    is unreachable.
    """

    MAX_RECONNECT_BACKOFF = 8.0

    def __init__(
        self,
        host: Optional[str] = None,
        port: Optional[int] = None,
        demo_mode: Optional[bool] = None,
    ) -> None:
        s = get_settings()
        self.host = host or s.ITECH_IP
        self.port = port or s.ITECH_PORT
        self.demo_mode = s.DEMO_MODE if demo_mode is None else demo_mode

        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._lock = asyncio.Lock()
        self._connected = False
        self._sim = DemoSimulator()
        self._cmd_queue: asyncio.Queue[str] = asyncio.Queue(maxsize=256)

    @property
    def connected(self) -> bool:
        return self._connected

    async def connect(self, max_attempts: int = 4) -> bool:
        if self.demo_mode:
            self._connected = False
            return False
        delay = 0.25
        for attempt in range(1, max_attempts + 1):
            try:
                self._reader, self._writer = await asyncio.wait_for(
                    asyncio.open_connection(self.host, self.port),
                    timeout=1.0,
                )
                self._connected = True
                return True
            except (OSError, asyncio.TimeoutError):
                if attempt == max_attempts:
                    self._connected = False
                    return False
                await asyncio.sleep(min(delay, self.MAX_RECONNECT_BACKOFF))
                delay *= 2
        return False

    async def close(self) -> None:
        if self._writer:
            try:
                self._writer.close()
                await self._writer.wait_closed()
            except Exception:
                pass
        self._reader = None
        self._writer = None
        self._connected = False

    async def send(self, command: str) -> None:
        async with self._lock:
            if self.demo_mode or not self._writer:
                self._sim.note_command(command)
                return
            self._writer.write((command + "\n").encode())
            await self._writer.drain()

    async def query(self, command: str) -> str:
        async with self._lock:
            if self.demo_mode or not self._reader or not self._writer:
                return self._sim.respond(command)
            self._writer.write((command + "\n").encode())
            await self._writer.drain()
            line = await asyncio.wait_for(self._reader.readline(), timeout=2.0)
            return line.decode().strip()

    async def enqueue(self, command: str) -> None:
        """Fire-and-forget producer hook."""
        try:
            self._cmd_queue.put_nowait(command)
        except asyncio.QueueFull:
            pass

    async def drain_queue(self) -> None:
        while not self._cmd_queue.empty():
            await self.send(self._cmd_queue.get_nowait())

    async def stream_readings(
        self,
        test_id: str = "",
        mqt: str = "",
        interval_s: float = 0.5,
    ) -> AsyncIterator[Reading]:
        """Yield one Reading per ``interval_s``. Honours queue draining
        between samples so commands from the UI flow through promptly."""
        t0 = time.monotonic()
        while True:
            await self.drain_queue()
            if self.demo_mode or not self._connected:
                yield self._sim.next_reading(test_id=test_id, mqt=mqt, t=time.monotonic() - t0)
            else:
                v = float(await self.query("MEAS:VOLT?"))
                i = float(await self.query("MEAS:CURR?"))
                yield Reading(
                    timestamp=int(time.time() * 1000),
                    voltage=v,
                    current=i,
                    power=round(v * i, 4),
                    temperature=25.0,
                    test_id=test_id,
                    mqt=mqt,
                )
            await asyncio.sleep(interval_s)


class DemoSimulator:
    """Physically plausible synthetic curves for each IEC test.

    The shape is keyed by the ``mqt`` argument (e.g. ``"MQT11"``) so
    the same simulator can serve all tabs.
    """

    PROFILES = {
        # mqt: (V_nom, I_nom, T_low, T_high, period_s)
        "MQT11":  (48.0, 9.5, -40.0,  85.0, 120.0),   # thermal cycling
        "MQT12":  (48.0, 9.5, -40.0,  85.0,  90.0),   # humidity freeze
        "MQT13":  (48.0, 9.0,  82.0,  88.0, 600.0),   # damp heat 85/85
        "MQT18":  (12.0, 13.5, 25.0,  85.0,  60.0),   # bypass diode 1.35×Isc
        "MQT21":  (1500.0, 0.05, 25.0, 60.0, 600.0),  # PID
        "RCO":    (60.0, 25.0, 25.0,  85.0,  30.0),   # reverse current overload
        "GCT":    (6.0, 25.0,  25.0,  35.0,  10.0),   # ground continuity
        "LETID":  (36.0, 8.5,  70.0,  80.0, 300.0),
    }

    def __init__(self) -> None:
        self._t0 = time.monotonic()
        self._last_cmd: str = ""
        self._set_v: float = 48.0
        self._set_i: float = 9.5
        self._temp_setpoint: float = 25.0

    def note_command(self, cmd: str) -> None:
        self._last_cmd = cmd
        # Track last set-points so MEAS:VOLT?/MEAS:CURR? track reality.
        s = cmd.upper()
        for prefix in ("SOUR:VOLT:LEV:IMM", "SOUR:VOLT:LEV", "SOUR:VOLT"):
            if s.startswith(prefix) and prefix not in ("SOUR:VOLT:PROT:LEV",):
                try:
                    self._set_v = float(cmd.split()[-1])
                except (ValueError, IndexError):
                    pass
                return
        for prefix in ("SOUR:CURR:LEV:IMM", "SOUR:CURR:LEV", "SOUR:CURR"):
            if s.startswith(prefix) and "PROT" not in s:
                try:
                    self._set_i = float(cmd.split()[-1])
                except (ValueError, IndexError):
                    pass
                return
        if s.startswith("SOUR:TEMP"):
            try:
                self._temp_setpoint = float(cmd.split()[-1])
            except (ValueError, IndexError):
                pass

    def respond(self, cmd: str) -> str:
        s = cmd.upper()
        if "IDN" in s:
            return "ITECH,PV6000-DEMO,SIM,1.0"
        if "TEMP" in s:
            return f"{self._temp_setpoint + random.gauss(0, 0.3):.2f}"
        if "VOLT?" in s:
            return f"{self._set_v + random.gauss(0, 0.05):.4f}"
        if "CURR?" in s:
            return f"{self._set_i + random.gauss(0, 0.005):.4f}"
        if "POW" in s:
            return f"{self._set_v * self._set_i + random.gauss(0, 0.1):.3f}"
        return "OK"

    def next_reading(self, test_id: str = "", mqt: str = "", t: Optional[float] = None) -> Reading:
        if t is None:
            t = time.monotonic() - self._t0
        v_nom, i_nom, t_lo, t_hi, period = self.PROFILES.get(mqt.upper(), self.PROFILES["MQT11"])
        phase = (t % period) / period  # 0..1
        # Triangular temperature ramp between t_lo and t_hi
        if phase < 0.5:
            temp = t_lo + (t_hi - t_lo) * (phase * 2)
        else:
            temp = t_hi - (t_hi - t_lo) * ((phase - 0.5) * 2)
        # Voltage drifts with temperature (-3 mV/K typical PV)
        v = v_nom + (25.0 - temp) * 0.003 * v_nom / 48.0 + random.gauss(0, 0.05)
        # Current sinusoid + jitter
        i = i_nom + 0.05 * math.sin(t * 2 * math.pi / period) + random.gauss(0, 0.01)
        return Reading(
            timestamp=int(time.time() * 1000),
            voltage=round(v, 4),
            current=round(i, 4),
            power=round(v * i, 4),
            temperature=round(temp, 2),
            test_id=test_id,
            mqt=mqt,
        )


# ---------------------------------------------------------------------------
# Convenience: context manager that connects (or stays in demo) and closes.
# ---------------------------------------------------------------------------

@asynccontextmanager
async def scpi_session(demo_mode: Optional[bool] = None) -> AsyncIterator[ScpiClient]:
    client = ScpiClient(demo_mode=demo_mode)
    await client.connect()
    try:
        yield client
    finally:
        await client.close()


# Background runner pattern: spawn a task that pushes readings into a
# user-supplied callback (typically a WebSocket .send_text).
async def run_telemetry_loop(
    client: ScpiClient,
    on_reading: Callable[[dict], Awaitable[None]],
    test_id: str = "",
    mqt: str = "",
    interval_s: float = 0.5,
) -> None:
    async for r in client.stream_readings(test_id=test_id, mqt=mqt, interval_s=interval_s):
        await on_reading(r.to_dict())
