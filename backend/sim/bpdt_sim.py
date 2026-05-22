"""BPDT (IEC 61215-2 MQT 18.1) Bypass-Diode Thermal Test — DEMO simulator.

Replays the WAAREE-770 reference dataset baked into
``backend/tests/fixtures/bpdt_waaree_770_reference.json``. For each
bypass diode the forward voltage drop ``Vd`` follows a linear model in
the diode junction temperature ``Tj``::

    Vd(Tj) = slope * Tj + intercept

The reference fixture also pins the expected ``Tj`` at the end of the
1 h forward-bias soak (``Tj_calc_at_1h_c``) so the simulator can emit
deterministic initial/final pairs that the tolerance test pins to
±0.001 V.

Safety
------
This module is **demo-only**. A module-level assert refuses to import
when ``DEMO_MODE`` is False — there is no live PSU energization path
here. The real forward-bias 1.25*Isc hand-off lands in PR#52a/b once
the Basic-Check safety gate is wired through ``_enforce_basic_check``.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

try:
    from ..config import get_settings
except ImportError:  # pragma: no cover - script-mode fallback
    from backend.config import get_settings  # type: ignore[no-redef]

# Demo-only guard: importing this in live mode is a hard error so we
# can never accidentally route a "simulated" run onto real hardware.
assert get_settings().DEMO_MODE, (
    "bpdt_sim is a DEMO_MODE-only simulator; refusing to load with "
    "DEMO_MODE=False (live BPDT hand-off lands in PR#52a/b)."
)

_FIXTURE_PATH = (
    Path(__file__).resolve().parents[1]
    / "tests"
    / "fixtures"
    / "bpdt_waaree_770_reference.json"
)


def load_reference() -> dict[str, Any]:
    """Load the baked WAAREE-770 reference dataset from disk."""
    with _FIXTURE_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def _diode(diode_id: int) -> dict[str, Any]:
    ref = load_reference()
    for d in ref["diodes"]:
        if d["id"] == diode_id:
            return d
    raise KeyError(f"diode id {diode_id} not in WAAREE-770 reference fixture")


def vd_for(diode_id: int, tj_c: float) -> float:
    """Forward voltage Vd at junction temperature ``tj_c`` for one diode."""
    d = _diode(diode_id)
    slope = float(d["vd_vs_tj_slope_v_per_c"])
    intercept = float(d["vd_vs_tj_intercept_v"])
    return slope * tj_c + intercept


def simulate_1h_run(diode_id: int, ambient_c: float = 75.0) -> dict[str, float]:
    """Return the initial/final Vd, Tj pair for the 1 h forward-bias soak.

    ``tj_initial_c`` is the ambient at switch-on, ``tj_final_c`` is the
    reference end-of-soak junction temperature baked into the fixture.
    """
    d = _diode(diode_id)
    tj_initial = float(ambient_c)
    tj_final = float(d["tj_calc_at_1h_c"])
    return {
        "vd_initial_v": vd_for(diode_id, tj_initial),
        "vd_final_v": vd_for(diode_id, tj_final),
        "tj_initial_c": tj_initial,
        "tj_final_c": tj_final,
    }


# ---------------------------------------------------------------------------
# TODO(PR#52a/b): live PSU forward-bias hand-off — STUBBED.
#
# The live BPDT loop is gated behind the Basic-Check safety harness that
# lands in PR#52a (gate) and PR#52b (PSU energization path). Once those
# merge, replace this stub with a call into a gated `_psu_set_current`
# helper that drives 1.25 * Isc (16.6125 A for WAAREE-770) through the
# bias rail. Until then this function intentionally raises so a live
# wiring attempt fails loudly rather than silently no-op'ing.
# ---------------------------------------------------------------------------
def energize_forward_bias(_diode_id: int) -> None:
    """Stub for the live 1.25*Isc forward-bias soak — wired in PR#52a/b."""
    raise NotImplementedError(
        "BPDT forward-bias energization is gated on PR#52a/b "
        "(Basic-Check + PSU OUTPUT enable). Demo mode only for now."
    )
