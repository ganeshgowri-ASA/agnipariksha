"""IEC TS 60904-13 EL capture orchestrator — STUB (DEMO-only).

Forward-bias + camera grab are stubbed until (1) the camera SDK lands
and (2) PR #52 (claude/live-psu-gate-BYGP5) merges.
"""
from __future__ import annotations

import re
import time
from typing import Any, Dict

try:
    from ..config import get_settings
    from .camera import SimulatedELCamera
except ImportError:  # pragma: no cover - script-mode fallback
    from config import get_settings  # type: ignore[no-redef]
    from el.camera import SimulatedELCamera  # type: ignore[no-redef]

_MODULE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def run_el_capture(module_id: str, isc_a: float, exposure_ms: int, gain: float) -> Dict[str, Any]:
    """Run a single EL capture. Returns a stubbed result dict."""
    if not isinstance(module_id, str) or not _MODULE_ID_RE.match(module_id):
        raise ValueError("module_id must be 1..64 alphanumeric/_/- characters")
    if not (isinstance(isc_a, (int, float)) and 0.0 < isc_a <= 50.0):
        raise ValueError("isc_a must be in (0, 50] A")
    if not (isinstance(exposure_ms, int) and exposure_ms > 0):
        raise ValueError("exposure_ms must be a positive integer")
    if not (isinstance(gain, (int, float)) and gain > 0):
        raise ValueError("gain must be > 0")

    # SAFETY: when PR #52 (claude/live-psu-gate-BYGP5) merges, wrap the
    # forward-bias setpoint and OUTP ON below with _enforce_basic_check
    # from backend.api.scpi_routes. Until then this code path is
    # DEMO-ONLY — guarded by an assert on get_settings().DEMO_MODE.
    assert get_settings().DEMO_MODE, (
        "EL capture forward-bias path is DEMO-only until PR #52 lands."
    )
    # TODO(PR#52): forward-bias setpoint + OUTP ON go here.

    cam = SimulatedELCamera(demo_mode=True)
    cam.set_exposure_ms(exposure_ms)
    cam.set_gain(gain)
    frame = cam.capture()

    ts_ms = int(time.time() * 1000)
    return {
        "module_id": module_id,
        "image_path": f"data/el/{module_id}_{ts_ms}.png",
        "current_a": float(isc_a),
        "exposure_ms": int(exposure_ms),
        "gain": float(gain),
        "ts": ts_ms,
        "frame_shape": list(frame.shape),
        "demo": True,
    }
