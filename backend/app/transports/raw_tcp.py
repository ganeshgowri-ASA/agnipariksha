"""Raw TCP transport — bytes in, bytes out, no framing.

Used for vendor protocols that don't fit SCPI line-framing (e.g. raw
binary command streams). Defaults to reading up to a configurable byte
budget per ``recv`` call.
"""
from __future__ import annotations

import asyncio
from typing import Optional

from .base import Transport, TransportError


class RawTcpTransport(Transport):
    """Async TCP transport with no message framing."""

    def __init__(
        self,
        device_id: str,
        host: str,
        port: int,
        *,
        demo: bool = False,
        timeout_s: float = 2.0,
        connect_timeout_s: float = 1.0,
        read_bytes: int = 4096,
        opener=None,
    ) -> None:
        super().__init__(device_id, kind="raw_tcp", demo=demo, timeout_s=timeout_s)
        self.host = host
        self.port = port
        self.connect_timeout_s = connect_timeout_s
        self.read_bytes = read_bytes
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._opener = opener or asyncio.open_connection

    async def _connect_impl(self) -> None:
        self._reader, self._writer = await asyncio.wait_for(
            self._opener(self.host, self.port),
            timeout=self.connect_timeout_s,
        )

    async def _send_impl(self, command: str) -> None:
        if not self._writer:
            raise TransportError("not connected")
        self._writer.write(command.encode())
        await self._writer.drain()

    async def _recv_impl(self) -> str:
        if not self._reader:
            raise TransportError("not connected")
        data = await asyncio.wait_for(self._reader.read(self.read_bytes), timeout=self.timeout_s)
        return data.decode(errors="replace")

    async def _close_impl(self) -> None:
        w = self._writer
        self._reader = None
        self._writer = None
        if w is None:
            return
        try:
            w.close()
            await w.wait_closed()
        except Exception:
            pass

    async def _is_alive_impl(self) -> bool:
        return bool(self._writer and not self._writer.is_closing())
