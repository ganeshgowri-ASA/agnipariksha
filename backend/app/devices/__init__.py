"""Device registry — YAML manifests + runtime resolver.

YAML files in this directory describe each physical instrument the
station can talk to. The registry loads them at startup and constructs
:class:`backend.app.transports.Transport` instances on demand.
"""
from __future__ import annotations

from .registry import (
    Device,
    DeviceRegistry,
    get_registry,
    load_devices,
)

__all__ = ["Device", "DeviceRegistry", "get_registry", "load_devices"]
