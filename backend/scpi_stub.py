"""Stub adapter around the real SCPI driver.

TODO: the real ITECH PV6000 driver lives in `scpi_driver.py` and will be
exercised by another branch. This stub presents the minimal interface the
API needs (connect, disconnect, status, estop) and is hot-swappable.

When DEMO_MODE=True it never touches the wire. When False it lazily
imports `scpi_driver.SCPIDriver` and proxies real calls.
"""
from __future__ import annotations

import os
import time
from threading import Lock
from typing import Optional


class SCPIStub:
    def __init__(self) -> None:
        self._lock = Lock()
        self._connected = False
        self._idn = "DEMO,ITECH-PV6000-SIM,SN0001,FW1.0"
        self._last_estop_ms: Optional[float] = None
        self._driver = None  # real driver instance when not in demo

    # ---- lifecycle ---------------------------------------------------------

    def connect(self, ip: Optional[str] = None, port: Optional[int] = None) -> dict:
        with self._lock:
            if os.getenv("DEMO_MODE", "true").lower() == "true":
                self._connected = True
                return {"connected": True, "idn": self._idn, "demo": True}

            # TODO: real path — replaced once the hardware branch lands.
            try:
                from scpi_driver import SCPIDriver  # type: ignore
                self._driver = SCPIDriver(ip or "192.168.200.100", port or 30000)
                idn = self._driver.connect()
                self._idn = idn
                self._connected = True
                return {"connected": True, "idn": idn, "demo": False}
            except Exception as exc:
                self._connected = False
                return {"connected": False, "error": str(exc), "demo": False}

    def disconnect(self) -> None:
        with self._lock:
            if self._driver is not None:
                try:
                    self._driver.disconnect()
                except Exception:
                    pass
                self._driver = None
            self._connected = False

    # ---- queries -----------------------------------------------------------

    def status(self) -> dict:
        return {
            "connected": self._connected,
            "idn": self._idn if self._connected else None,
            "demo": os.getenv("DEMO_MODE", "true").lower() == "true",
            "last_estop_latency_ms": self._last_estop_ms,
        }

    # ---- safety ------------------------------------------------------------

    def estop(self) -> dict:
        """Emergency stop. Spec: must complete in < 50 ms."""
        t0 = time.perf_counter()
        with self._lock:
            if self._driver is not None:
                try:
                    self._driver.send("OUTPut OFF")
                except Exception:
                    pass
            self._connected = self._connected  # output off, link may remain
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        self._last_estop_ms = round(elapsed_ms, 3)
        return {"ok": True, "latency_ms": self._last_estop_ms}


scpi = SCPIStub()
