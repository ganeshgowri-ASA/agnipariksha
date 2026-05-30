"""LeTID Test — IEC TS 63342:2022

Light and elevated Temperature Induced Degradation

Test Parameters (IEC TS 63342:2022):
- Temperature: 75°C ± 3°C
- Irradiance: 1 sun equivalent OR dark injection
- Dark current injection: Idark = Isc - Imp (bypass current)
- Duration: 162 hours minimum
- Measurement intervals: Every 2 hours (power output)
- Pass/Fail: Pmax degradation < 2% from STC

Power Supply Role:
- Inject dark current: Idark = Isc - Imp at module Vmpp
- Maintain constant current for full 162 h duration
- Monitor for current drift > 0.5%
"""
import asyncio
import math
import uuid
import time
from dataclasses import dataclass
from scpi_driver import SCPIDriver

# IEC TS 63342 constants — mirrored on the frontend in
# frontend/features/letid/analysis/darkVoltage.ts (LETID_DARKV_CONSTANTS) so the
# dark-voltage stabilization (stop) criterion and the measurement-uncertainty
# budget cannot drift between client display and server control. Update both
# files together when the standard revisions land.
LETID_DARK_CURRENT_EPS_A = 0.05          # |I| ≤ this counts as a dark (no-injection) sample
LETID_STABILIZATION_WINDOW_HRS = 24.0    # trailing window for steady-state assessment
LETID_STABILIZATION_REL_THRESHOLD = 0.005  # max relative dark-V drift over the window (0.5 %)
LETID_MIN_SOAK_HRS = 162.0               # TS 63342 minimum soak before a stop may be declared
LETID_CAL_REL_STD = 0.002                # relative calibration uncertainty of the V/Pmax reading (1σ)
LETID_VOLT_RESOLUTION_V = 0.001          # voltmeter last-digit resolution (V)
LETID_COVERAGE_K = 2.0                   # coverage factor for expanded uncertainty (≈ 95 %)


@dataclass(frozen=True)
class StopCriterion:
    """Outcome of :func:`letid_stop_criterion`."""

    met: bool
    reason: str
    relative_drift: float | None  # trailing ΔV/V (fraction), or None if window not full
    window_span_hrs: float


@dataclass(frozen=True)
class Uncertainty:
    """Outcome of :func:`dark_voltage_uncertainty`."""

    standard: float   # combined standard uncertainty u_c (1σ), measurement unit
    expanded: float   # expanded uncertainty U = k·u_c
    k: float          # coverage factor
    relative: float   # U / |value| (NaN if value == 0)


def letid_stop_criterion(
    series: list[tuple[float, float]],
    window_hrs: float = LETID_STABILIZATION_WINDOW_HRS,
    rel_threshold: float = LETID_STABILIZATION_REL_THRESHOLD,
    min_soak_hrs: float = LETID_MIN_SOAK_HRS,
) -> StopCriterion:
    """IEC TS 63342 dark-voltage stabilization (stop) criterion.

    The LeTID soak may be stopped once the dark voltage has *stabilized*: the
    relative change (max − min)/mean across the trailing ``window_hrs`` of
    dark-phase samples stays within ``rel_threshold``, AND the module has been
    soaked for at least ``min_soak_hrs``. Using the max−min spread (rather than a
    signed slope) keeps the test running through both an ongoing degradation and
    a regeneration until the curve genuinely flattens.

    Mirrors ``stopCriterion`` in the frontend ``darkVoltage.ts`` so the operator
    dashboard and the bench orchestrator draw the same conclusion.

    Args:
        series: dark-phase samples as ``(hours, dark_voltage)`` tuples.
        window_hrs: trailing window over which steady state is assessed.
        rel_threshold: max permitted relative dark-V change within the window.
        min_soak_hrs: minimum soak before a stop may be declared.

    Returns:
        A :class:`StopCriterion`. ``met`` is False (with a descriptive reason)
        when data is insufficient, the trailing window is too short, the drift
        exceeds the threshold, or the minimum soak has not elapsed.
    """
    if not series:
        return StopCriterion(False, "No dark-voltage samples yet.", None, 0.0)

    pts = sorted(series, key=lambda p: p[0])
    last_h = pts[-1][0]
    soak_hrs = last_h - pts[0][0]

    lo = math.inf
    hi = -math.inf
    total = 0.0
    count = 0
    window_start_h = last_h
    for h, v in reversed(pts):
        if h < last_h - window_hrs:
            break
        lo = min(lo, v)
        hi = max(hi, v)
        total += v
        count += 1
        window_start_h = h
    window_span_hrs = last_h - window_start_h

    if count < 2 or window_span_hrs < window_hrs - 1e-9:
        return StopCriterion(
            False,
            f"Stabilization window not yet full ({window_span_hrs:.1f} h of {window_hrs:.0f} h).",
            None,
            window_span_hrs,
        )

    mean = total / count
    relative_drift = (hi - lo) / abs(mean) if mean != 0 else math.inf
    drift_pct = relative_drift * 100
    thr_pct = rel_threshold * 100

    if relative_drift > rel_threshold:
        return StopCriterion(
            False,
            f"Not stabilized: trailing ΔV/V={drift_pct:.3f}% over {window_hrs:.0f} h "
            f"> {thr_pct:.2f}% (TS 63342 stabilization).",
            relative_drift,
            window_span_hrs,
        )
    if soak_hrs < min_soak_hrs:
        return StopCriterion(
            False,
            f"Dark voltage stable (ΔV/V={drift_pct:.3f}% ≤ {thr_pct:.2f}%) but soak "
            f"{soak_hrs:.0f} h < {min_soak_hrs:.0f} h minimum (TS 63342).",
            relative_drift,
            window_span_hrs,
        )
    return StopCriterion(
        True,
        f"Stabilized: trailing ΔV/V={drift_pct:.3f}% ≤ {thr_pct:.2f}% over {window_hrs:.0f} h "
        f"after {soak_hrs:.0f} h soak (TS 63342).",
        relative_drift,
        window_span_hrs,
    )


def dark_voltage_uncertainty(
    value: float,
    cal_rel_std: float = LETID_CAL_REL_STD,
    resolution: float = LETID_VOLT_RESOLUTION_V,
    k: float = LETID_COVERAGE_K,
) -> Uncertainty:
    """Combined + expanded measurement uncertainty of a dark-voltage / Pmax reading.

    GUM root-sum-square model used by IEC test reports. Two components combine in
    quadrature: a calibration component relative to the reading
    (``u_cal = cal_rel_std·|value|``) and a rectangular resolution component
    (``u_res = resolution/√12``). The expanded uncertainty is ``U = k·u_c``
    (default ``k = 2`` → ≈ 95 % coverage).

    Mirrors ``measurementUncertainty`` in the frontend ``darkVoltage.ts``.
    """
    u_cal = cal_rel_std * abs(value)
    u_res = resolution / math.sqrt(12)
    standard = math.hypot(u_cal, u_res)
    expanded = k * standard
    relative = expanded / abs(value) if value != 0 else math.nan
    return Uncertainty(standard=standard, expanded=expanded, k=k, relative=relative)


class LeTIDTest:
    STANDARD = "IEC TS 63342:2022"
    DURATION_HOURS = 162
    TEMP_TARGET = 75.0
    TEMP_TOLERANCE = 3.0
    MEASUREMENT_INTERVAL_S = 7200  # 2 hours
    
    def __init__(self, scpi: SCPIDriver):
        self.scpi = scpi
        self.session_id = str(uuid.uuid4())
        self.running = False

    def calculate_idark(self, isc: float, imp: float) -> float:
        """Dark current = Isc - Imp per IEC TS 63342:2022"""
        return round(isc - imp, 4)

    async def start(
        self,
        vmpp: float = 37.5,    # V_mpp at STC (V)
        isc: float = 9.5,      # I_sc at STC (A)  
        imp: float = 8.9,      # I_mp at STC (A)
        voc: float = 45.0,     # V_oc at STC (V)
        duration_h: int = DURATION_HOURS,
    ) -> str:
        self.running = True
        idark = self.calculate_idark(isc, imp)
        duration_s = duration_h * 3600
        
        print(f"[LeTID] Session {self.session_id}")
        print(f"  Idark = {isc:.2f} - {imp:.2f} = {idark:.4f} A")
        print(f"  Vmpp = {vmpp:.2f} V | Duration = {duration_h} h")
        
        # Set CV mode at Vmpp, inject Idark
        await self.scpi.set_ovp(voc * 1.05)
        await self.scpi.set_ocp(isc * 1.1)
        await self.scpi.set_voltage(vmpp)
        await self.scpi.set_current(idark)
        await self.scpi.set_output(True)
        
        # Run for full duration with periodic measurement
        asyncio.create_task(self._monitor_loop(duration_s))
        return self.session_id

    async def _monitor_loop(self, duration_s: int):
        start_time = time.time()
        while self.running and (time.time() - start_time) < duration_s:
            measurements = await self.scpi.measure_all()
            elapsed_h = (time.time() - start_time) / 3600
            print(f"[LeTID] t={elapsed_h:.1f}h V={measurements['voltage']:.3f}V I={measurements['current']:.4f}A")
            # TODO: Store to TimescaleDB
            await asyncio.sleep(self.MEASUREMENT_INTERVAL_S)
        await self.scpi.set_output(False)
        self.running = False
        print(f"[LeTID] Test complete. Session: {self.session_id}")

    async def stop(self):
        self.running = False
        await self.scpi.emergency_stop()
