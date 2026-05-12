"""Modbus TCP transport — minimal MBAP-framed read/write.

This implementation supports the two function codes Agnipariksha
needs against environmental chambers and DC sources:

* 0x03 — Read holding registers
* 0x06 — Write single register

Commands use the textual form ``"<unit>:<fc>:<addr>[:value]"`` so a
single string parameter works with the ``Transport.send`` /
``Transport.query`` contract and shows up cleanly in the audit log.
"""
from __future__ import annotations

import asyncio
import struct
from typing import Optional

from .base import Transport, TransportError


def _parse_command(command: str) -> tuple[int, int, int, Optional[int]]:
    parts = command.split(":")
    if len(parts) < 3:
        raise TransportError(f"bad modbus command: {command!r}")
    unit = int(parts[0], 0)
    fc = int(parts[1], 0)
    addr = int(parts[2], 0)
    value = int(parts[3], 0) if len(parts) >= 4 else None
    return unit, fc, addr, value


class ModbusTcpTransport(Transport):
    """Async Modbus TCP transport (raw — no external dependency).

    Only function codes 3 (read holding) and 6 (write single) are
    implemented. Sufficient for chamber temperature setpoints and
    most DC source monitor registers.
    """

    def __init__(
        self,
        device_id: str,
        host: str,
        port: int = 502,
        *,
        unit_id: int = 1,
        demo: bool = False,
        timeout_s: float = 2.0,
        opener=None,
    ) -> None:
        super().__init__(device_id, kind="modbus_tcp", demo=demo, timeout_s=timeout_s)
        self.host = host
        self.port = port
        self.unit_id = unit_id
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._tid = 0
        self._last_response: Optional[str] = None
        self._opener = opener or asyncio.open_connection

    async def _connect_impl(self) -> None:
        self._reader, self._writer = await asyncio.wait_for(
            self._opener(self.host, self.port),
            timeout=self.timeout_s,
        )

    def _next_tid(self) -> int:
        self._tid = (self._tid + 1) & 0xFFFF
        return self._tid

    def _frame(self, unit: int, pdu: bytes) -> bytes:
        tid = self._next_tid()
        mbap = struct.pack(">HHHB", tid, 0, len(pdu) + 1, unit)
        return mbap + pdu

    async def _send_impl(self, command: str) -> None:
        if not self._writer:
            raise TransportError("not connected")
        unit, fc, addr, value = _parse_command(command)
        if fc == 3:
            qty = value if value is not None else 1
            pdu = struct.pack(">BHH", fc, addr, qty)
        elif fc == 6:
            if value is None:
                raise TransportError("FC06 requires value")
            pdu = struct.pack(">BHH", fc, addr, value & 0xFFFF)
        else:
            raise TransportError(f"FC {fc} not supported")
        frame = self._frame(unit, pdu)
        self._writer.write(frame)
        await self._writer.drain()
        # Capture the response inline so the matched read shows up in audit.
        resp = await asyncio.wait_for(self._reader.read(260), timeout=self.timeout_s)  # type: ignore[union-attr]
        self._last_response = resp.hex()

    async def _recv_impl(self) -> str:
        if self._last_response is None:
            raise TransportError("no pending response")
        r = self._last_response
        self._last_response = None
        return r

    async def _query_impl(self, command: str) -> str:
        await self._send_impl(command)
        return await self._recv_impl()

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
            await self._query_impl(f"{self.unit_id}:3:0:1")
            return True
        except Exception:
            return False

    def _demo_response(self, command: str) -> str:
        # Three bytes per register, one register read by default.
        return "000300020000"
