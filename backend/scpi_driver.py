"""Back-compat shim for the legacy ``SCPIDriver`` symbol.

The real implementation now lives in :mod:`backend.psu.itech`. This
module exists purely so existing call sites (``from scpi_driver import
SCPIDriver``, ``import scpi_driver`` for ``DEVICE_IP``) keep working
both in package mode (``from backend.scpi_driver import ...``) and in
script mode (``sys.path.insert(0, 'backend'); import scpi_driver``).

New code should import from :mod:`backend.psu` directly.
"""
from __future__ import annotations

try:  # package-mode (backend.scpi_driver)
    from .psu.itech import (  # noqa: F401
        BUFFER_SIZE,
        DEVICE_IP,
        DEVICE_PORT,
        TIMEOUT,
        ITechPV6000Driver as SCPIDriver,
    )
except ImportError:  # script-mode (uvicorn main:app from inside backend/)
    from psu.itech import (  # type: ignore[no-redef]  # noqa: F401
        BUFFER_SIZE,
        DEVICE_IP,
        DEVICE_PORT,
        TIMEOUT,
        ITechPV6000Driver as SCPIDriver,
    )

__all__ = ["SCPIDriver", "DEVICE_IP", "DEVICE_PORT", "BUFFER_SIZE", "TIMEOUT"]
