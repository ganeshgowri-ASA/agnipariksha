"""SCPI over USBTMC via pyvisa.

pyvisa is synchronous, so we offload its calls to the default executor.
The import is lazy so missing ``pyvisa`` only breaks USBTMC users.
"""
from __future__ import annotations

import asyncio
from typing import Any, Optional

from .base import Transport, TransportError


class ScpiUsbtmcTransport(Transport):
    """SCPI over USBTMC; thin async wrapper around pyvisa."""

    def __init__(
        self,
        device_id: str,
        resource: str,
        *,
        demo: bool = False,
        timeout_s: float = 2.0,
    ) -> None:
        super().__init__(device_id, kind="scpi_usbtmc", demo=demo, timeout_s=timeout_s)
        self.resource = resource
        self._instr: Optional[Any] = None
        self._rm: Optional[Any] = None

    def _open_sync(self) -> None:
        import pyvisa  # local import — optional dep
        self._rm = pyvisa.ResourceManager("@py")
        self._instr = self._rm.open_resource(self.resource)
        self._instr.timeout = int(self.timeout_s * 1000)

    async def _connect_impl(self) -> None:
        await asyncio.get_event_loop().run_in_executor(None, self._open_sync)

    async def _send_impl(self, command: str) -> None:
        if not self._instr:
            raise TransportError("not connected")
        await asyncio.get_event_loop().run_in_executor(None, self._instr.write, command)

    async def _recv_impl(self) -> str:
        if not self._instr:
            raise TransportError("not connected")
        result = await asyncio.get_event_loop().run_in_executor(None, self._instr.read)
        return str(result).strip()

    async def _query_impl(self, command: str) -> str:
        if not self._instr:
            raise TransportError("not connected")
        result = await asyncio.get_event_loop().run_in_executor(
            None, self._instr.query, command
        )
        return str(result).strip()

    async def _close_impl(self) -> None:
        loop = asyncio.get_event_loop()

        def _close() -> None:
            try:
                if self._instr is not None:
                    self._instr.close()
            finally:
                if self._rm is not None:
                    self._rm.close()
            self._instr = None
            self._rm = None

        await loop.run_in_executor(None, _close)

    async def _is_alive_impl(self) -> bool:
        if not self._instr:
            return False
        try:
            return bool(await self._query_impl("*IDN?"))
        except Exception:
            return False
