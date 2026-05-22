"""Orchestrators for IEC safety/degradation test sequences.

Each orchestrator owns the state machine for one IEC test (TC, HF,
LeTID, BDT, RCO, GCT) and exposes a uniform ``to_dict()`` snapshot.
DEMO_MODE is enforced inside ``_enforce_basic_check``; live
energization paths are guarded by ``# TODO(PR#52a/b)`` markers until
the real safety gate lands.
"""
from __future__ import annotations

try:
    from ..config import get_settings
except ImportError:  # pragma: no cover - script-mode fallback
    from config import get_settings  # type: ignore[no-redef]


def _enforce_basic_check() -> None:
    """STUB - full safety gate lands in PR#52a/b. Today only enforces
    that orchestrators never run outside ``DEMO_MODE``."""
    assert get_settings().DEMO_MODE, (
        "orchestrator: live-mode energization blocked until PR#52a/b "
        "merges (_enforce_basic_check stubbed)."
    )
