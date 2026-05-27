"""IEC 61215-2:2021 MQT 18.1 — Bypass Diode Thermal Test: setup model.

Pure range validation, a DEMO/LIVE mode switch, and setup persistence. No
PSU energization happens here: the LIVE start path raises until
owner-at-bench + E-stop confirmation lands in a later PR. The Start button
is enabled iff ``is_valid(setup)``.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import List

# --- Acceptance-criteria ranges (IEC 61215-2 MQT 18.1) ---------------------
ISC_MIN_A: float = 1.0
ISC_MAX_A: float = 20.0
TEST_CURRENT_FACTOR: float = 1.25  # test current = 1.25 x Isc
SOAK_NOMINAL_C: float = 75.0
SOAK_TOLERANCE_C: float = 5.0  # 75 C +/- 5 C
SOAK_MIN_C: float = SOAK_NOMINAL_C - SOAK_TOLERANCE_C  # 70
SOAK_MAX_C: float = SOAK_NOMINAL_C + SOAK_TOLERANCE_C  # 80
DIODE_COUNT_MIN: int = 1
DIODE_COUNT_MAX: int = 6
LIVE_NOT_IMPLEMENTED_MSG = "LIVE BDT requires owner-at-bench + E-stop confirmation"


class BdtMode(str, Enum):
    DEMO = "DEMO"
    LIVE = "LIVE"


def default_test_current_a(isc_a: float) -> float:
    """Auto-computed test current = 1.25 x Isc (rounded to 3 dp)."""
    return round(isc_a * TEST_CURRENT_FACTOR, 3)


@dataclass
class BdtSetup:
    isc_a: float
    soak_temp_c: float = SOAK_NOMINAL_C
    diode_count: int = 1
    diode_locations: List[str] = field(default_factory=list)
    mode: BdtMode = BdtMode.DEMO
    # None means "use the auto-computed 1.25 x Isc"; editable upward only.
    test_current_a: float | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.mode, BdtMode):
            self.mode = BdtMode(self.mode)
        if self.test_current_a is None:
            self.test_current_a = default_test_current_a(self.isc_a)

    @property
    def min_test_current_a(self) -> float:
        return default_test_current_a(self.isc_a)

    def to_dict(self) -> dict:
        return {
            "isc_a": self.isc_a,
            "test_current_a": self.test_current_a,
            "soak_temp_c": self.soak_temp_c,
            "diode_count": self.diode_count,
            "diode_locations": list(self.diode_locations),
            "mode": self.mode.value,
        }


def validate_setup(s: BdtSetup) -> List[str]:
    """Return human-readable validation errors; empty list means valid."""
    errors: List[str] = []

    if not (ISC_MIN_A <= s.isc_a <= ISC_MAX_A):
        errors.append(f"Module Isc must be {ISC_MIN_A:g}-{ISC_MAX_A:g} A.")

    tc = s.test_current_a
    if tc is None or tc + 1e-9 < s.min_test_current_a:
        errors.append(f"Test current must be >= 1.25 x Isc ({s.min_test_current_a:g} A).")

    if not (SOAK_MIN_C <= s.soak_temp_c <= SOAK_MAX_C):
        errors.append(f"Chamber soak temp must be {SOAK_MIN_C:g}-{SOAK_MAX_C:g} C (75 +/- 5 C).")

    if not (isinstance(s.diode_count, int) and DIODE_COUNT_MIN <= s.diode_count <= DIODE_COUNT_MAX):
        errors.append(f"Diode count must be an integer {DIODE_COUNT_MIN}-{DIODE_COUNT_MAX}.")

    labels = [x for x in s.diode_locations if isinstance(x, str) and x.strip()]
    if not (isinstance(s.diode_count, int) and len(labels) == s.diode_count):
        errors.append("Provide exactly one non-empty location label per diode.")

    return errors


def is_valid(s: BdtSetup) -> bool:
    """Start button is enabled iff this returns True."""
    return not validate_setup(s)


def setup_dir(session_id: str, base_dir: Path | str = ".") -> Path:
    return Path(base_dir) / "tests" / "bdt" / session_id


def start_session(s: BdtSetup, session_id: str, base_dir: Path | str = ".") -> Path:
    """Validate then handle Start by mode.

    DEMO -> persist setup.json to tests/bdt/<sessionId>/ and return the path.
    LIVE -> raise NotImplementedError (no PSU energization here).
    """
    errors = validate_setup(s)
    if errors:
        raise ValueError("; ".join(errors))

    if s.mode is BdtMode.LIVE:
        raise NotImplementedError(LIVE_NOT_IMPLEMENTED_MSG)

    out_dir = setup_dir(session_id, base_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "setup.json"
    path.write_text(json.dumps(s.to_dict(), indent=2, sort_keys=True), encoding="utf-8")
    return path
