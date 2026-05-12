"""SCPI over raw TCP (the ITECH PV6000 native transport).

The instrument terminates messages with ``\\n``; replies are line-based.
"""
from __future__ import annotations

import asyncio
from typing import Optional

from .base import Transport, TransportError


class ScpiTcpTransport(Transport):
    """Async TCP transport speaking SCPI with newline framing."""

    EOL = b"\n"

    def __init__(
        self,
        device_id: str,
        host: str,
        port: int = 30000,
        *,
        demo: bool = False,
        timeout_s: float = 2.0,
        connect_timeout_s: float = 1.0,
        opener=None,
    ) -> None:
        super().__init__(device_id, kind="scpi_tcp", demo=demo, timeout_s=timeout_s)
        self.host = host
        self.port = port
        self.connect_timeout_s = connect_timeout_s
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        # ``opener`` is an injection seam for unit tests that supply a fake
        # ``open_connection``-compatible coroutine.
        self._opener = opener or asyncio.open_connection

    async def _connect_impl(self) -> None:
        self._reader, self._writer = await asyncio.wait_for(
            self._opener(self.host, self.port),
            timeout=self.connect_timeout_s,
        )

    async def _send_impl(self, command: str) -> None:
        if not self._writer:
            raise TransportError("not connected")
        self._writer.write(command.encode() + self.EOL)
        await self._writer.drain()

    async def _recv_impl(self) -> str:
        if not self._reader:
            raise TransportError("not connected")
        line = await asyncio.wait_for(self._reader.readline(), timeout=self.timeout_s)
        return line.decode(errors="replace").strip()

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
        if not self._writer or self._writer.is_closing():
            return False
        try:
            idn = await self._query_impl("*IDN?")
            return bool(idn)
        except Exception:
            return False

    def _demo_response(self, command: str) -> str:
        if "VOLT?" in command:
            return "48.0000"
        if "CURR?" in command:
            return "9.5000"
        if "POW" in command and "?" in command:
            return "456.0000"
        return super()._demo_response(command)
