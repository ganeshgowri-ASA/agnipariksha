"""Abstract ``Transport`` base + audit-log machinery.

Every concrete transport (TCP, USBTMC, Modbus, RTU, RS232) inherits
from :class:`Transport` and implements the ``_connect_impl``,
``_send_impl``, ``_recv_impl``, ``_close_impl`` and ``_is_alive_impl``
hooks. The base class layers on:

* an ``asyncio.Lock`` so concurrent callers serialise across a single
  underlying handle,
* capped exponential back-off on connect,
* an in-memory + file-backed audit log entry for each command,
* a uniform :class:`TransportState` for health/UI exposure.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from abc import ABC, abstractmethod
from collections import deque
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Deque, Iterable, Optional


_LOG = logging.getLogger("agnipariksha.transport")


class TransportError(RuntimeError):
    """Raised when a transport operation fails."""


class TransportState(str, Enum):
    INIT = "init"
    CONNECTING = "connecting"
    LIVE = "live"
    DEMO = "demo"
    DOWN = "down"
    CLOSED = "closed"


@dataclass
class AuditEntry:
    """One line in the audit log — one per ``send`` / ``recv`` pair."""

    ts_ms: int
    device_id: str
    kind: str
    op: str
    command: str
    response: Optional[str] = None
    duration_ms: float = 0.0
    ok: bool = True
    error: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)


class AuditLog:
    """In-memory ring buffer with optional file mirror.

    Designed to be cheap on hot paths — appending an entry is O(1) and
    file I/O is best-effort (a missing log dir doesn't break commands).
    """

    def __init__(self, maxlen: int = 2000, file_path: Optional[Path] = None) -> None:
        self._buf: Deque[AuditEntry] = deque(maxlen=maxlen)
        self._file = file_path
        self._lock = asyncio.Lock()

    def append(self, entry: AuditEntry) -> None:
        self._buf.append(entry)
        if self._file is not None:
            try:
                self._file.parent.mkdir(parents=True, exist_ok=True)
                with self._file.open("a", encoding="utf-8") as fh:
                    fh.write(entry.to_json() + "\n")
            except OSError:
                pass

    def tail(self, n: int = 100, device_id: Optional[str] = None) -> list[AuditEntry]:
        items: Iterable[AuditEntry] = self._buf
        if device_id is not None:
            items = (e for e in items if e.device_id == device_id)
        return list(items)[-n:]

    def clear(self) -> None:
        self._buf.clear()


_AUDIT: Optional[AuditLog] = None


def get_audit_log() -> AuditLog:
    """Process-wide singleton; created lazily so import-time is cheap."""
    global _AUDIT
    if _AUDIT is None:
        _AUDIT = AuditLog(file_path=Path("logs") / "transports_audit.log")
    return _AUDIT


class Transport(ABC):
    """Abstract base class for hardware transports.

    Subclasses provide the protocol-specific I/O; the base provides the
    concurrency, back-off and audit plumbing.
    """

    MAX_BACKOFF_S: float = 8.0
    BASE_BACKOFF_S: float = 0.25
    DEFAULT_TIMEOUT_S: float = 2.0

    def __init__(
        self,
        device_id: str,
        *,
        kind: str,
        demo: bool = False,
        timeout_s: float = DEFAULT_TIMEOUT_S,
        audit: Optional[AuditLog] = None,
    ) -> None:
        self.device_id = device_id
        self.kind = kind
        self.demo = demo
        self.timeout_s = timeout_s
        self._audit = audit or get_audit_log()
        self._lock = asyncio.Lock()
        self._state: TransportState = TransportState.INIT
        self._last_error: Optional[str] = None
        self._last_alive_ms: int = 0

    # ------------------------------------------------------------------ state
    @property
    def state(self) -> TransportState:
        return self._state

    @property
    def last_error(self) -> Optional[str]:
        return self._last_error

    @property
    def last_alive_ms(self) -> int:
        return self._last_alive_ms

    def set_demo(self, demo: bool) -> None:
        self.demo = demo
        if demo:
            self._state = TransportState.DEMO

    # ------------------------------------------------------------------ hooks
    @abstractmethod
    async def _connect_impl(self) -> None: ...

    @abstractmethod
    async def _send_impl(self, command: str) -> None: ...

    @abstractmethod
    async def _recv_impl(self) -> str: ...

    @abstractmethod
    async def _close_impl(self) -> None: ...

    @abstractmethod
    async def _is_alive_impl(self) -> bool: ...

    # Optional: subclasses with a native query may override for efficiency.
    async def _query_impl(self, command: str) -> str:
        await self._send_impl(command)
        return await self._recv_impl()

    # Demo responder — subclasses may override to fake protocol semantics.
    def _demo_response(self, command: str) -> str:
        if "IDN" in command or "*IDN" in command:
            return f"DEMO,{self.kind},{self.device_id},0.0"
        return "OK"

    # ------------------------------------------------------------------ public
    async def connect(self, max_attempts: int = 4) -> bool:
        """Connect with capped exponential back-off. Returns True on live link."""
        if self.demo:
            self._state = TransportState.DEMO
            return False
        self._state = TransportState.CONNECTING
        delay = self.BASE_BACKOFF_S
        for attempt in range(1, max_attempts + 1):
            try:
                await asyncio.wait_for(self._connect_impl(), timeout=self.timeout_s + 1.0)
                self._state = TransportState.LIVE
                self._last_error = None
                self._last_alive_ms = int(time.time() * 1000)
                return True
            except Exception as exc:  # noqa: BLE001 — surface any backend failure
                self._last_error = f"{type(exc).__name__}: {exc}"
                _LOG.warning("connect attempt %d failed for %s: %s", attempt, self.device_id, exc)
                if attempt == max_attempts:
                    self._state = TransportState.DOWN
                    return False
                await asyncio.sleep(min(delay, self.MAX_BACKOFF_S))
                delay *= 2
        return False

    async def send(self, command: str) -> None:
        await self._with_audit("send", command, awaitable=self._do_send(command))

    async def recv(self) -> str:
        return await self._with_audit("recv", "", awaitable=self._do_recv(), capture_response=True)

    async def query(self, command: str) -> str:
        return await self._with_audit(
            "query", command, awaitable=self._do_query(command), capture_response=True
        )

    async def close(self) -> None:
        try:
            await self._close_impl()
        finally:
            self._state = TransportState.CLOSED

    async def is_alive(self) -> bool:
        """Cheap liveness probe used by the health task."""
        if self.demo:
            self._last_alive_ms = int(time.time() * 1000)
            self._state = TransportState.DEMO
            return True
        try:
            ok = await asyncio.wait_for(self._is_alive_impl(), timeout=self.timeout_s)
        except Exception as exc:  # noqa: BLE001
            self._last_error = f"{type(exc).__name__}: {exc}"
            ok = False
        if ok:
            self._last_alive_ms = int(time.time() * 1000)
            self._state = TransportState.LIVE
        else:
            self._state = TransportState.DOWN
        return ok

    # ------------------------------------------------------------------ wiring
    async def _do_send(self, command: str) -> Optional[str]:
        async with self._lock:
            if self.demo or self._state in (TransportState.DEMO, TransportState.DOWN, TransportState.INIT):
                self._demo_response(command)  # noop, lets a sim track state
                return None
            await self._send_impl(command)
            return None

    async def _do_recv(self) -> str:
        async with self._lock:
            if self.demo or self._state in (TransportState.DEMO, TransportState.DOWN, TransportState.INIT):
                return self._demo_response("")
            return await self._recv_impl()

    async def _do_query(self, command: str) -> str:
        async with self._lock:
            if self.demo or self._state in (TransportState.DEMO, TransportState.DOWN, TransportState.INIT):
                return self._demo_response(command)
            return await self._query_impl(command)

    async def _with_audit(
        self,
        op: str,
        command: str,
        awaitable,
        capture_response: bool = False,
    ) -> Any:
        t0 = time.perf_counter()
        ok = True
        err: Optional[str] = None
        resp: Optional[str] = None
        try:
            result = await awaitable
            if capture_response:
                resp = str(result) if result is not None else ""
            return result
        except Exception as exc:  # noqa: BLE001
            ok = False
            err = f"{type(exc).__name__}: {exc}"
            self._last_error = err
            raise
        finally:
            self._audit.append(
                AuditEntry(
                    ts_ms=int(time.time() * 1000),
                    device_id=self.device_id,
                    kind=self.kind,
                    op=op,
                    command=command,
                    response=resp,
                    duration_ms=round((time.perf_counter() - t0) * 1000, 3),
                    ok=ok,
                    error=err,
                )
            )
