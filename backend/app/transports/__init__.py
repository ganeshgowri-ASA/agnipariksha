"""Pluggable hardware transport abstractions.

All concrete transports inherit from :class:`Transport` and may be wired
up to a device entry under ``backend/app/devices/*.yaml``. Concrete
classes are imported lazily so that optional dependencies
(``pyserial``, ``pyvisa``) don't break import-time for unrelated callers.
"""
from __future__ import annotations

from .base import (
    AuditEntry,
    AuditLog,
    Transport,
    TransportError,
    TransportState,
    get_audit_log,
)

__all__ = [
    "AuditEntry",
    "AuditLog",
    "Transport",
    "TransportError",
    "TransportState",
    "get_audit_log",
    "build_transport",
]


def build_transport(kind: str, **opts):
    """Factory: resolve a transport class by short name and construct it.

    Concrete modules are imported lazily so optional libraries are only
    required when the corresponding transport is actually used.
    """
    kind_norm = kind.replace("-", "_").lower()
    if kind_norm == "scpi_tcp":
        from .scpi_tcp import ScpiTcpTransport
        return ScpiTcpTransport(**opts)
    if kind_norm == "scpi_usbtmc":
        from .scpi_usbtmc import ScpiUsbtmcTransport
        return ScpiUsbtmcTransport(**opts)
    if kind_norm == "modbus_tcp":
        from .modbus_tcp import ModbusTcpTransport
        return ModbusTcpTransport(**opts)
    if kind_norm == "modbus_rtu":
        from .modbus_rtu import ModbusRtuTransport
        return ModbusRtuTransport(**opts)
    if kind_norm == "raw_tcp":
        from .raw_tcp import RawTcpTransport
        return RawTcpTransport(**opts)
    if kind_norm in ("rs232", "serial"):
        from .rs232 import Rs232Transport
        return Rs232Transport(**opts)
    raise TransportError(f"unknown transport kind: {kind!r}")
