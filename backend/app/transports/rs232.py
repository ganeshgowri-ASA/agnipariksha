"""RS-232 / serial transport (pyserial in a thread executor)."""
from __future__ import annotations

import asyncio
from typing import Any, Optional

from .base import Transport, TransportError


class Rs232Transport(Transport):
    """Async wrapper around ``pyserial.Serial``.

    Defaults are the most common SCPI serial settings (9600 8N1).
    """

    def __init__(
        self,
        device_id: str,
        port: str,
        *,
        baudrate: int = 9600,
        bytesize: int = 8,
        parity: str = "N",
        stopbits: float = 1,
        eol: str = "\n",
        demo: bool = False,
        timeout_s: float = 2.0,
    ) -> None:
        super().__init__(device_id, kind="rs232", demo=demo, timeout_s=timeout_s)
        self.port = port
        self.baudrate = baudrate
        self.bytesize = bytesize
        self.parity = parity
        self.stopbits = stopbits
        self.eol = eol.encode()
        self._ser: Optional[Any] = None

    def _open_sync(self) -> Any:
        import serial  # local import — optional dep

        return serial.Serial(
            port=self.port,
            baudrate=self.baudrate,
            bytesize=self.bytesize,
            parity=self.parity,
            stopbits=self.stopbits,
            timeout=self.timeout_s,
        )

    async def _connect_impl(self) -> None:
        self._ser = await asyncio.get_event_loop().run_in_executor(None, self._open_sync)

    async def _send_impl(self, command: str) -> None:
        if not self._ser:
            raise TransportError("not connected")
        payload = command.encode() + self.eol
        await asyncio.get_event_loop().run_in_executor(None, self._ser.write, payload)

    async def _recv_impl(self) -> str:
        if not self._ser:
            raise TransportError("not connected")
        data = await asyncio.get_event_loop().run_in_executor(None, self._ser.readline)
        return bytes(data).decode(errors="replace").strip()

    async def _close_impl(self) -> None:
        ser = self._ser
        self._ser = None
        if ser is None:
            return
        await asyncio.get_event_loop().run_in_executor(None, ser.close)

    async def _is_alive_impl(self) -> bool:
        return bool(self._ser is not None and getattr(self._ser, "is_open", False))
