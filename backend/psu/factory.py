"""DEMO_MODE-aware PSU factory.

``get_psu_for_mode()`` returns a :class:`SimulatedPSUDriver` when
``Settings.DEMO_MODE`` is true, otherwise the configured live driver
(currently always ITech PV6000).

Keeping the mode-routing in a single function lets callers stay agnostic
to whether the system is in demo or live - they always get back a
``PSUDriver``.
"""
from __future__ import annotations

from typing import Optional

from . import sim  # noqa: F401  (side-effect: registers "sim")
from .base import PSUDriver
from .registry import get_driver

try:  # package-mode (backend.psu.factory)
    from ..config import get_settings
except ImportError:  # script-mode
    from config import get_settings  # type: ignore[no-redef]


def get_psu_for_mode(live_make: str = "itech_pv6000", demo_mode: Optional[bool] = None) -> PSUDriver:
    """Return a PSUDriver instance appropriate for the current mode.

    Parameters
    ----------
    live_make
        Key in the registry to use when ``demo_mode`` is false. Defaults
        to the ITech PV6000.
    demo_mode
        Override ``Settings.DEMO_MODE`` for testing. ``None`` (default)
        means "consult the settings".
    """
    use_demo = get_settings().DEMO_MODE if demo_mode is None else demo_mode
    if use_demo:
        return get_driver("sim")()
    return get_driver(live_make)()
