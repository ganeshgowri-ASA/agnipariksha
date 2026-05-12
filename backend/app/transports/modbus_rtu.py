"""Modbus RTU over serial — pyserial behind a thread executor.

Same textual command syntax as :mod:`modbus_tcp`. Includes a
streaming CRC16 for frame validation.
"""
from __future__ import annotations

import asyncio
import struct
from typing import Any, Optional

from .base import Transport, TransportError
from .modbus_tcp import _parse_command


def _crc16(data: bytes) -> int:
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
    return crc


class ModbusRtuTransport(Transport):
    """Modbus RTU transport."""

    def __init__(
        self,
        device_id: str,
        port: str,
        *,
        baudrate: int = 19200,
        parity: str = "N",
        stopbits: float = 1,
        unit_id: int = 1,
        demo: bool = False,
        timeout_s: float = 2.0,
    ) -> None:
        super().__init__(device_id, kind="modbus_rtu", demo=demo, timeout_s=timeout_s)
        self.port = port
        self.baudrate = baudrate
        self.parity = parity
        self.stopbits = stopbits
        self.unit_id = unit_id
        self._ser: Optional[Any] = None
        self._last_response: Optional[str] = None

    def _open_sync(self) -> Any:
        import serial  # local import — optional dep

        return serial.Serial(
            port=self.port,
            baudrate=self.baudrate,
            bytesize=8,
            parity=self.parity,
            stopbits=self.stopbits,
            timeout=self.timeout_s,
        )

    async def _connect_impl(self) -> None:
        self._ser = await asyncio.get_event_loop().run_in_executor(None, self._open_sync)

    def _build_frame(self, command: str) -> bytes:
        unit, fc, addr, value = _parse_command(command)
        if fc == 3:
            qty = value if value is not None else 1
            body = struct.pack(">BBHH", unit, fc, addr, qty)
        elif fc == 6:
            if value is None:
                raise TransportError("FC06 requires value")
            body = struct.pack(">BBHH", unit, fc, addr, value & 0xFFFF)
        else:
            raise TransportError(f"FC {fc} not supported")
        crc = _crc16(body)
        return body + struct.pack("<H", crc)

    async def _send_impl(self, command: str) -> None:
        if not self._ser:
            raise TransportError("not connected")
        frame = self._build_frame(command)
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._ser.write, frame)
        resp = await loop.run_in_executor(None, self._ser.read, 256)
        self._last_response = bytes(resp).hex()

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
        ser = self._ser
        self._ser = None
        if ser is None:
            return
        await asyncio.get_event_loop().run_in_executor(None, ser.close)

    async def _is_alive_impl(self) -> bool:
        return bool(self._ser is not None and getattr(self._ser, "is_open", False))

    def _demo_response(self, command: str) -> str:
        return "01030200000000"
