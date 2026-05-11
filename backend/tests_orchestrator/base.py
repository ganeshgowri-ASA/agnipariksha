"""Shared base types for the IEC test orchestrators.

The orchestrators are designed to drive the ITECH PV6000 over a SCPI
interface, but they never bind to a concrete driver class — they speak
to anything that implements :class:`DriverProtocol`. This keeps the
real ``SCPIDriver`` (whose methods are synchronous) interchangeable
with the in-process :class:`DemoDriver` (whose methods are async),
because the orchestrators always call driver methods via
``BaseOrchestrator._drv_call`` which adapts sync→async automatically.
"""
from __future__ import annotations

import asyncio
import inspect
import time
import uuid
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import (
    Any,
    AsyncGenerator,
    Awaitable,
    Callable,
    Dict,
    Optional,
    Protocol,
    runtime_checkable,
)


class OrchestratorState(str, Enum):
    IDLE = "idle"
    RUNNING = "running"
    STOPPING = "stopping"
    COMPLETED = "completed"
    FAILED = "failed"
    ABORTED = "aborted"


@dataclass
class Sample:
    t: float            # seconds since test start
    voltage: float
    current: float
    power: float
    step: str = ""
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ComplianceResult:
    standard: str
    passed: bool
    reason: str
    metrics: Dict[str, Any] = field(default_factory=dict)

    @property
    def verdict(self) -> str:
        return "PASS" if self.passed else "FAIL"

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["verdict"] = self.verdict
        return d


@runtime_checkable
class DriverProtocol(Protocol):
    """Minimal interface a driver must expose.

    The orchestrators only rely on the methods listed here. Methods may
    be sync or async; ``BaseOrchestrator._drv_call`` handles both.
    """

    def set_voltage(self, v: float) -> Any: ...
    def set_current(self, i: float) -> Any: ...
    def set_ovp(self, v: float) -> Any: ...
    def set_ocp(self, i: float) -> Any: ...
    def output_on(self) -> Any: ...
    def output_off(self) -> Any: ...
    def measure_voltage(self) -> Any: ...
    def measure_current(self) -> Any: ...
    def measure_power(self) -> Any: ...


class BaseOrchestrator:
    """Common machinery: state, status snapshot, sample queue, lifecycle."""

    STANDARD: str = ""
    NAME: str = "base"

    def __init__(self, driver: DriverProtocol, *, sample_interval_s: float = 1.0):
        self.driver = driver
        self.sample_interval_s = sample_interval_s

        self.session_id: str = ""
        self.state: OrchestratorState = OrchestratorState.IDLE
        self.step: str = ""
        self.progress: float = 0.0          # 0..1
        self.elapsed: float = 0.0
        self.remaining: float = 0.0
        self.duration_s: float = 0.0
        self.last_sample: Optional[Sample] = None
        self.compliance: Optional[ComplianceResult] = None
        self.error: Optional[str] = None
        self.params: Dict[str, Any] = {}

        self._t0: float = 0.0
        self._task: Optional[asyncio.Task] = None
        self._stop_event = asyncio.Event()
        self._sample_queue: asyncio.Queue[Optional[Sample]] = asyncio.Queue(maxsize=1024)
        self._samples_log: list[Sample] = []

    # ------------------------------------------------------------------ driver
    async def _drv_call(self, name: str, *args, **kwargs):
        """Invoke a driver method whether it is sync or async."""
        fn = getattr(self.driver, name, None)
        if fn is None:
            raise AttributeError(f"driver has no method {name!r}")
        result = fn(*args, **kwargs)
        if inspect.isawaitable(result):
            return await result
        return result

    async def _measure(self, step: str = "") -> Sample:
        v = await self._drv_call("measure_voltage")
        i = await self._drv_call("measure_current")
        try:
            p = await self._drv_call("measure_power")
        except Exception:
            p = float(v) * float(i)
        t = time.monotonic() - self._t0
        s = Sample(t=round(t, 4), voltage=float(v), current=float(i),
                   power=float(p), step=step or self.step)
        self.last_sample = s
        self._samples_log.append(s)
        try:
            self._sample_queue.put_nowait(s)
        except asyncio.QueueFull:
            # Drop oldest to keep the live stream fresh.
            try:
                self._sample_queue.get_nowait()
                self._sample_queue.put_nowait(s)
            except Exception:
                pass
        return s

    # ----------------------------------------------------------------- lifecycle
    async def start(self, params: Optional[Dict[str, Any]] = None) -> str:
        if self.state == OrchestratorState.RUNNING:
            raise RuntimeError(f"{self.NAME} already running")
        self.params = dict(params or {})
        self.session_id = str(uuid.uuid4())
        self.state = OrchestratorState.RUNNING
        self.error = None
        self.compliance = None
        self.progress = 0.0
        self.elapsed = 0.0
        self.remaining = self.duration_s
        self._t0 = time.monotonic()
        self._stop_event = asyncio.Event()
        self._sample_queue = asyncio.Queue(maxsize=1024)
        self._samples_log = []
        self._task = asyncio.create_task(self._run_wrapper())
        return self.session_id

    async def _run_wrapper(self):
        try:
            await self._run()
            if self.state == OrchestratorState.RUNNING:
                self.state = OrchestratorState.COMPLETED
            self.compliance = self.validate()
        except asyncio.CancelledError:
            self.state = OrchestratorState.ABORTED
            raise
        except Exception as exc:
            self.state = OrchestratorState.FAILED
            self.error = f"{type(exc).__name__}: {exc}"
        finally:
            try:
                await self._drv_call("output_off")
            except Exception:
                pass
            await self._sample_queue.put(None)  # sentinel ends the stream

    async def _run(self):
        raise NotImplementedError

    async def stop(self) -> None:
        if self.state not in (OrchestratorState.RUNNING, OrchestratorState.STOPPING):
            return
        self.state = OrchestratorState.STOPPING
        self._stop_event.set()
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=10.0)
            except asyncio.TimeoutError:
                self._task.cancel()
                try:
                    await self._task
                except Exception:
                    pass

    def _update_progress(self):
        self.elapsed = time.monotonic() - self._t0
        if self.duration_s > 0:
            self.progress = min(1.0, self.elapsed / self.duration_s)
            self.remaining = max(0.0, self.duration_s - self.elapsed)

    def status(self) -> Dict[str, Any]:
        self._update_progress()
        return {
            "name": self.NAME,
            "standard": self.STANDARD,
            "session_id": self.session_id,
            "state": self.state.value,
            "step": self.step,
            "progress": round(self.progress, 4),
            "elapsed": round(self.elapsed, 2),
            "remaining": round(self.remaining, 2),
            "duration_s": self.duration_s,
            "last_sample": self.last_sample.to_dict() if self.last_sample else None,
            "error": self.error,
            "compliance": self.compliance.to_dict() if self.compliance else None,
            "params": self.params,
        }

    async def stream_samples(self) -> AsyncGenerator[Sample, None]:
        """Yield samples as they are produced; ends when the test ends."""
        while True:
            item = await self._sample_queue.get()
            if item is None:
                return
            yield item

    # --------------------------------------------------------------- compliance
    def validate(self) -> ComplianceResult:
        """Override in subclasses to compute the IEC pass/fail verdict."""
        return ComplianceResult(
            standard=self.STANDARD,
            passed=self.state == OrchestratorState.COMPLETED,
            reason="completed without exception" if self.state == OrchestratorState.COMPLETED
                   else f"state={self.state.value}",
        )


async def _sleep_or_stop(stop_event: asyncio.Event, seconds: float) -> bool:
    """Wait ``seconds`` or until ``stop_event`` fires. Returns True if stopped."""
    if seconds <= 0:
        return stop_event.is_set()
    try:
        await asyncio.wait_for(stop_event.wait(), timeout=seconds)
        return True
    except asyncio.TimeoutError:
        return False
