"""Ground Continuity Test — IEC 61730-2 MST 13

Test Parameters:
- Test current: 25A AC (or DC equivalent)
- Voltage drop limit: < 2.5 V (implies R < 0.1 Ω)
- Pass criterion: Resistance < 0.1 Ω between frame and earth
- Duration: Until stable reading (< 30 seconds)

Power Supply Role (DC method):
- Source 25A DC through frame-to-earth path
- Measure voltage drop
- Calculate R = V/I
- Pass if R < 0.1 Ω
"""
import asyncio
import uuid
import time
from scpi_driver import SCPIDriver

# IEC 61730-2 MST 13 dual-path constants — mirrored on the frontend in
# frontend/features/gct/analysis/dualPath.ts (DUAL_PATH_CONSTANTS) so the
# per-path resistance limit and the frame-current tolerance band cannot
# drift between client and server. Update both files together when the
# standard revisions land.
MST13_MAX_R_OHM = 0.1            # MST 13 — R between conductive part & ground shall be < 0.1 Ω
NOMINAL_FRAME_CURRENT_A = 25.0   # MST 13 — nominal bonding/frame test current (A)
FRAME_CURRENT_TOL_FRAC = 0.1     # ± fraction of nominal the injected current must stay within

# Inclusive bounds of the valid frame-current band (A).
FRAME_CURRENT_MIN_A = NOMINAL_FRAME_CURRENT_A * (1 - FRAME_CURRENT_TOL_FRAC)
FRAME_CURRENT_MAX_A = NOMINAL_FRAME_CURRENT_A * (1 + FRAME_CURRENT_TOL_FRAC)

# Contexts the dual-path continuity log can be attributed to. Ground
# continuity per MST 13 is reused across these cross-cutting sequences.
GC_CONTEXTS = ("COP", "DPTT", "LeTID", "IDD")


def path_resistance_verdict(r_ohm: float) -> str:
    """Grade a single path resistance against the MST 13 limit.

    Strictly less-than 0.1 Ω is ``"conform"``; the boundary (exactly
    0.1 Ω) and above are ``"non-conform"`` — the criterion is strictly
    less-than for safety margin. A missing/impossible reading (non-finite
    or negative) cannot prove conformity, so it is ``"non-conform"``.
    Mirrors ``pathResistanceVerdict`` on the frontend.
    """
    if r_ohm != r_ohm or r_ohm in (float("inf"), float("-inf")):  # NaN / ±inf
        return "non-conform"
    if r_ohm < 0:
        return "non-conform"
    return "conform" if r_ohm < MST13_MAX_R_OHM else "non-conform"


def frame_current_in_band(amps: float) -> bool:
    """Return True iff the injected frame current is within the ± band of
    the 25 A nominal (MST 13). Endpoints are inclusive; non-finite values
    are out of band. Mirrors ``frameCurrentInBand`` on the frontend.
    """
    if amps != amps or amps in (float("inf"), float("-inf")):  # NaN / ±inf
        return False
    return FRAME_CURRENT_MIN_A <= amps <= FRAME_CURRENT_MAX_A


def dual_path_verdict(shortest_r, longest_r, injected_a) -> str:
    """Compose the overall MST 13 dual-path verdict.

    ``"pending"`` until both path resistances and the injected current are
    present (not ``None``). Once present: ``"non-conform"`` if EITHER path
    is at/above the 0.1 Ω limit OR the injected current is out of band;
    otherwise ``"conform"``. Mirrors ``dualPathVerdict`` on the frontend.
    """
    if shortest_r is None or longest_r is None or injected_a is None:
        return "pending"
    current_ok = frame_current_in_band(injected_a)
    shortest_ok = path_resistance_verdict(shortest_r) == "conform"
    longest_ok = path_resistance_verdict(longest_r) == "conform"
    return "conform" if (current_ok and shortest_ok and longest_ok) else "non-conform"


class GroundContinuityTest:
    STANDARD = "IEC 61730-2 MST 13"
    TEST_CURRENT_A = 25.0
    PASS_RESISTANCE_OHM = 0.1
    TEST_VOLTAGE_LIMIT_V = 2.5
    STABILIZE_TIME_S = 5
    
    def __init__(self, scpi: SCPIDriver):
        self.scpi = scpi
        self.session_id = str(uuid.uuid4())

    async def run(self) -> dict:
        """Run complete ground continuity test, return PASS/FAIL result."""
        print(f"[GCT] Session {self.session_id} — Injecting {self.TEST_CURRENT_A}A")
        
        # Configure CC mode: 25A, voltage limit 2.5V
        await self.scpi.send("SOUR:FUNC CURR")  # CC priority
        await self.scpi.set_current(self.TEST_CURRENT_A)
        await self.scpi.set_ovp(self.TEST_VOLTAGE_LIMIT_V * 1.1)
        await self.scpi.set_output(True)
        
        # Wait for stabilization
        await asyncio.sleep(self.STABILIZE_TIME_S)
        
        # Measure
        v = await self.scpi.measure_voltage()
        i = await self.scpi.measure_current()
        
        # Calculate resistance
        r = v / i if i > 0.1 else 999.0
        passed = r < self.PASS_RESISTANCE_OHM
        
        await self.scpi.set_output(False)
        
        result = {
            "session_id": self.session_id,
            "test": "ground_continuity",
            "standard": self.STANDARD,
            "voltage_v": round(v, 4),
            "current_a": round(i, 4),
            "resistance_ohm": round(r, 6),
            "pass_limit_ohm": self.PASS_RESISTANCE_OHM,
            "result": "PASS" if passed else "FAIL",
            "timestamp": time.time(),
        }
        print(f"[GCT] R = {r:.6f} Ω → {'PASS ✓' if passed else 'FAIL ✗'}")
        return result
