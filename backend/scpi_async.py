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


class ScpiUnreachable(RuntimeError):
    """Raised in LIVE mode (DEMO_MODE=false) when the ITECH socket is not
    available — either ``connect()`` failed or the reader/writer was never
    established. The router translates this to HTTP 503.

    Intentionally does NOT inherit from any "soft" exception class so that
    misconfigured ``except Exception`` handlers cannot silently downgrade
    a hardware fault into simulator data.
    """

    def __init__(self, host: str, port: int, reason: str) -> None:
        super().__init__(f"SCPI unreachable {host}:{port} ({reason})")
        self.host = host
        self.port = port
        self.reason = reason


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
        s = get_settings()
        # Honour the configured probe timeout, with a 1 s floor so callers
        # that override ITECH_TIMEOUT_MS very low don't make every connect
        # hopeless. Cap at 5 s to keep failure-mode latency bounded.
        per_attempt_timeout = max(1.0, min(5.0, s.ITECH_TIMEOUT_MS / 1000.0))
        delay = 0.25
        last_exc: Optional[BaseException] = None
        for attempt in range(1, max_attempts + 1):
            try:
                self._reader, self._writer = await asyncio.wait_for(
                    asyncio.open_connection(self.host, self.port),
                    timeout=per_attempt_timeout,
                )
                self._connected = True
                return True
            except (OSError, asyncio.TimeoutError) as exc:
                last_exc = exc
                if attempt == max_attempts:
                    self._connected = False
                    # Live mode: bubble the failure up so callers cannot
                    # silently downgrade to simulator data.
                    raise ScpiUnreachable(
                        self.host,
                        self.port,
                        f"connect failed after {max_attempts} attempts "
                        f"(per-attempt timeout {per_attempt_timeout:.1f}s): "
                        f"{type(exc).__name__}: {exc}",
                    ) from exc
                await asyncio.sleep(min(delay, self.MAX_RECONNECT_BACKOFF))
                delay *= 2
        # Unreachable under normal control flow but keeps the type checker happy.
        raise ScpiUnreachable(self.host, self.port, f"connect exhausted: {last_exc!r}")

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
            if self.demo_mode:
                self._sim.note_command(command)
                return
            if not self._writer:
                raise ScpiUnreachable(
                    self.host, self.port,
                    "send() called before successful connect() in live mode",
                )
            self._writer.write((command + "\n").encode())
            await self._writer.drain()

    async def query(self, command: str) -> str:
        async with self._lock:
            if self.demo_mode:
                return self._sim.respond(command)
            if not self._reader or not self._writer:
                raise ScpiUnreachable(
                    self.host, self.port,
                    "query() called before successful connect() in live mode",
                )
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

    Output / setpoint state (Issue #106 — PR-1)
    --------------------------------------------
    The simulator now tracks ``output_on`` plus ``v_setpoint`` /
    ``i_setpoint``. SCPI write commands of the form ``OUTP[ut] {ON|OFF|1|0}``
    and ``SOUR[ce]:VOLT[age][:LEVel[:IMMediate]] <v>`` /
    ``SOUR[ce]:CURR[ent][:LEVel[:IMMediate]] <i>`` mutate this state.
    ``MEAS:*?`` queries then return values that track the setpoints
    when output is ON (with a small Gaussian noise model) and a small
    idle-leakage reading when output is OFF — matching what an operator
    sees on a real PV6000 front panel.

    LIVE PSU at 192.168.200.100:30000 stays READ-ONLY; this state only
    lives inside the DEMO simulator. Safety gate (Issue #96) unchanged.
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

    # Idle leakage when OUTP is OFF — matches what the PV6000 reports
    # with a cold load attached.
    IDLE_V = 21.91
    IDLE_I = -0.02
    AMBIENT_T = 25.0
    # IEC 61215-2 MQT 11 ramp ceiling — the DEMO chamber must NOT exceed
    # this so the frontend's ramp-compliance pill (TC analysis) reports
    # PASS in DEMO instead of artificially failing the simulator.
    MAX_RAMP_C_PER_S = 100.0 / 3600.0  # 100 °C / h → 0.0278 °C / s

    def __init__(self) -> None:
        self._t0 = time.monotonic()
        self._last_cmd: str = ""
        # Setpoint + output state — mutated by note_command()
        self.output_on: bool = False
        self.v_setpoint: float = 48.0
        self.i_setpoint: float = 9.5
        # Thermal model — module temperature ramps toward the operating
        # target at ≤ MAX_RAMP_C_PER_S (MQT 11.6.2 compliant). State is
        # updated lazily on every MEAS:TEMP? call so we don't need a
        # background asyncio loop just for the simulator.
        self._t_module_c: float = self.AMBIENT_T
        self._last_temp_sample_t: float = time.monotonic()

    # ------------------------------------------------------------------
    # Command parsing (write path)
    # ------------------------------------------------------------------
    @staticmethod
    def _normalise(cmd: str) -> str:
        """Upper-case + strip — SCPI is case-insensitive and tolerates
        long/short mnemonics (``OUTPut`` vs ``OUTP``). We only need to
        recognise the prefix, so a normalised, upper-cased view is enough."""
        return cmd.strip().upper()

    @staticmethod
    def _parse_on_off(token: str) -> Optional[bool]:
        t = token.strip().upper()
        if t in ("1", "ON"):
            return True
        if t in ("0", "OFF"):
            return False
        return None

    def note_command(self, cmd: str) -> None:
        """Apply a SCPI write (OUTP / SOUR:VOLT / SOUR:CURR) to sim state.

        Unknown commands are recorded but otherwise ignored — matches the
        permissive behaviour of the real PV6000 front panel.
        """
        self._last_cmd = cmd
        norm = self._normalise(cmd)

        # OUTP / OUTPut <on|off|1|0>
        if norm.startswith("OUTP") and "?" not in norm:
            parts = norm.split()
            if len(parts) >= 2:
                val = self._parse_on_off(parts[1])
                if val is not None:
                    self.output_on = val
            return

        # SOUR[CE]:VOLT[AGE][:LEVel[:IMMediate]] <value>
        if ("SOUR" in norm and "VOLT" in norm and "?" not in norm) or \
                norm.startswith("VOLT "):
            try:
                self.v_setpoint = float(norm.rsplit(maxsplit=1)[-1])
            except (ValueError, IndexError):
                pass
            return

        # SOUR[CE]:CURR[ENT][:LEVel[:IMMediate]] <value>
        if ("SOUR" in norm and "CURR" in norm and "?" not in norm) or \
                norm.startswith("CURR "):
            try:
                self.i_setpoint = float(norm.rsplit(maxsplit=1)[-1])
            except (ValueError, IndexError):
                pass
            return

    # ------------------------------------------------------------------
    # Query handling (read path)
    # ------------------------------------------------------------------
    def _meas_voltage(self) -> float:
        if not self.output_on:
            return self.IDLE_V + random.gauss(0, 0.02)
        return self.v_setpoint + random.gauss(0, max(0.01, 0.005 * abs(self.v_setpoint)))

    def _meas_current(self) -> float:
        if not self.output_on:
            return self.IDLE_I + random.gauss(0, 0.005)
        return self.i_setpoint + random.gauss(0, max(0.005, 0.005 * abs(self.i_setpoint)))

    def _meas_temperature(self) -> float:
        """Realistic IEC-compliant ramp model.

        When ``output_on`` flips ON we choose an operating target
        proportional to the dissipated power (same shape as before)
        but we approach it at ≤ 100 °C/h (MQT 11.6.2 ceiling). When
        OUTP flips OFF we ramp back to ambient at the same rate. The
        result is that the TC Analysis pane sees a believable ≈90 °C/h
        ramp instead of an instantaneous step that the (correct) IEC
        verdict logic was flagging as FAIL.

        Side-effects: updates ``self._t_module_c`` and
        ``self._last_temp_sample_t``. Idempotent within a single
        scheduler tick because the elapsed time is measured against the
        last call's wall-clock.
        """
        now = time.monotonic()
        dt = max(0.0, now - self._last_temp_sample_t)
        self._last_temp_sample_t = now

        # Target: ambient when output is OFF; self-heating delta when ON.
        if self.output_on:
            power = self.v_setpoint * self.i_setpoint
            target = self.AMBIENT_T + min(60.0, max(0.0, abs(power) * 0.08))
        else:
            target = self.AMBIENT_T

        # Approach target at the IEC ramp ceiling — deterministic step.
        max_step = self.MAX_RAMP_C_PER_S * dt
        delta = target - self._t_module_c
        if abs(delta) <= max_step:
            self._t_module_c = target
        else:
            self._t_module_c += max_step if delta > 0 else -max_step

        return self._t_module_c + random.gauss(0, 0.1)

    def respond(self, cmd: str) -> str:
        norm = self._normalise(cmd)
        if "IDN" in norm:
            return "ITECH,PV6000-DEMO,SIM,1.0"
        # OUTP? — return the simulator's current output state, not UNKNOWN.
        if norm.startswith("OUTP") and "?" in norm:
            return "1" if self.output_on else "0"
        if "VOLT?" in norm:
            return f"{self._meas_voltage():.4f}"
        if "CURR?" in norm:
            return f"{self._meas_current():.4f}"
        if "TEMP?" in norm:
            return f"{self._meas_temperature():.4f}"
        if "POW" in norm and "?" in norm:
            # Derive P from the (just-computed) V and I so callers always
            # see P ≈ V·I within tolerance.
            v = self._meas_voltage()
            i = self._meas_current()
            return f"{v * i:.4f}"
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
