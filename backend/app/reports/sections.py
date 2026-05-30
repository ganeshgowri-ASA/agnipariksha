"""Per-test extended section data + synthetic DEMO generators.

Each dataclass here mirrors what a populated test DB would surface for the
matching IEC clause. Demo data is produced by deterministic generators (no
RNG) that approximate the physical shape of a real run — chamber sinusoids,
exponential dark-V decay, rolling/cumulative ramp computation, etc. — so
the report does not render placeholder values.

The generators are kept here (not in ``fixtures``) so a future DB-backed
loader can swap in real ``TelemetrySample`` rows without touching the
template or chart helpers.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Optional, Tuple


# ---------------------------------------------------------------------------
# 1. Thermal Cycling — IEC 61215-2 MQT 11
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class TCSample:
    t_min: float
    mod_t_c: float
    current_a: float


@dataclass(frozen=True)
class TCSection:
    clause: str
    position: str            # "Bifacial" / "BSI" / "BNBI"
    jbox_mass_kg: float
    schematic_ref: str
    samples: List[TCSample]
    set_ramp_c_per_min: float
    temp_range_c: Tuple[float, float]
    dwell_min_min: float
    tolerance_temp_c: float
    tolerance_ramp_c_per_min: float

    @property
    def actual_ramp_pt(self) -> List[Tuple[float, float]]:
        """Point-to-point (rolling 3-sample window) °C/min — SET vs ACTUAL."""
        out: List[Tuple[float, float]] = []
        s = self.samples
        for i in range(1, len(s)):
            dt = max(s[i].t_min - s[i - 1].t_min, 1e-6)
            out.append((s[i].t_min, (s[i].mod_t_c - s[i - 1].mod_t_c) / dt))
        return out

    @property
    def actual_ramp_cum(self) -> List[Tuple[float, float]]:
        """Cumulative / running-average ramp °C/min from t=0."""
        out: List[Tuple[float, float]] = []
        s = self.samples
        for i in range(1, len(s)):
            dt = max(s[i].t_min - s[0].t_min, 1e-6)
            out.append((s[i].t_min, (s[i].mod_t_c - s[0].mod_t_c) / dt))
        return out

    @property
    def nonconform(self) -> List[str]:
        """Human-readable NON-CONFORM flags (empty when in tolerance)."""
        out: List[str] = []
        lo, hi = self.temp_range_c
        for s in self.samples:
            if s.mod_t_c < lo - self.tolerance_temp_c or s.mod_t_c > hi + self.tolerance_temp_c:
                out.append(f"t={s.t_min:.1f} min: T={s.mod_t_c:.2f} °C outside [{lo - self.tolerance_temp_c:.1f}, {hi + self.tolerance_temp_c:.1f}]")
                break
        for _, r in self.actual_ramp_pt:
            if abs(r) > self.set_ramp_c_per_min + self.tolerance_ramp_c_per_min:
                out.append(f"point-to-point ramp {r:.2f} °C/min exceeds {self.set_ramp_c_per_min + self.tolerance_ramp_c_per_min:.2f}")
                break
        return out


# ---------------------------------------------------------------------------
# 2. Humidity Freeze — IEC 61215-2 MQT 12
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class HFSample:
    t_min: float
    mod_t_c: float
    rh_pct: float
    current_a: float


@dataclass(frozen=True)
class HFSection:
    clause: str
    ramp_mode_c_per_h: int  # 100 or 200 — selectable per spec
    samples: List[HFSample]
    set_ramp_c_per_min: float
    tolerance_temp_c: float
    tolerance_rh_pct: float
    tolerance_current_pct: float
    uniformity_t_c: float
    uniformity_rh_pct: float

    @property
    def actual_ramp_pt(self) -> List[Tuple[float, float]]:
        out: List[Tuple[float, float]] = []
        s = self.samples
        for i in range(1, len(s)):
            dt = max(s[i].t_min - s[i - 1].t_min, 1e-6)
            out.append((s[i].t_min, (s[i].mod_t_c - s[i - 1].mod_t_c) / dt))
        return out

    @property
    def actual_ramp_cum(self) -> List[Tuple[float, float]]:
        out: List[Tuple[float, float]] = []
        s = self.samples
        for i in range(1, len(s)):
            dt = max(s[i].t_min - s[0].t_min, 1e-6)
            out.append((s[i].t_min, (s[i].mod_t_c - s[0].mod_t_c) / dt))
        return out


# ---------------------------------------------------------------------------
# 3. PID — IEC TS 62804-1
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class PIDSample:
    t_min: float
    chamber_t_c: float
    rh_pct: float
    leakage_a: float


@dataclass(frozen=True)
class PIDSection:
    clause: str
    samples: List[PIDSample]
    stabilization_h: float           # 12-24 h, configurable per spec
    t_tolerance_c: float
    rh_tolerance_pct: float
    leakage_threshold_a: float
    post_stab_t_tolerance_c: float   # tighter post-stabilization
    post_stab_rh_tolerance_pct: float
    setpoint_t_c: float
    setpoint_rh_pct: float

    @property
    def nonconform(self) -> List[str]:
        """Flag any post-stabilization sample outside the tighter tolerance."""
        cutoff_min = self.stabilization_h * 60
        out: List[str] = []
        for s in self.samples:
            if s.t_min < cutoff_min:
                continue
            if abs(s.chamber_t_c - self.setpoint_t_c) > self.post_stab_t_tolerance_c:
                out.append(f"t={s.t_min/60:.1f} h: T={s.chamber_t_c:.2f} °C deviates > {self.post_stab_t_tolerance_c} °C")
                break
        for s in self.samples:
            if s.t_min < cutoff_min:
                continue
            if abs(s.rh_pct - self.setpoint_rh_pct) > self.post_stab_rh_tolerance_pct:
                out.append(f"t={s.t_min/60:.1f} h: RH={s.rh_pct:.2f} % deviates > {self.post_stab_rh_tolerance_pct} %")
                break
        for s in self.samples:
            if s.leakage_a > self.leakage_threshold_a:
                out.append(f"t={s.t_min/60:.1f} h: leakage {s.leakage_a*1e6:.2f} µA exceeds threshold")
                break
        return out


# ---------------------------------------------------------------------------
# 4. LeTID — IEC TS 63342
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class LeTIDSample:
    t_min: float
    mod_t_c: float
    dark_v_v: float
    current_a: float


@dataclass(frozen=True)
class LeTIDSection:
    clause: str
    samples: List[LeTIDSample]
    stop_criteria: str
    uncertainty_t_c: float
    uncertainty_voltage_v: float
    uncertainty_current_a: float


# ---------------------------------------------------------------------------
# 6. Reverse Current Overload — IEC 61730 MST 26
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class RCOTempSample:
    t_min: float
    mod_t_c: float


@dataclass(frozen=True)
class RCOSection:
    clause: str
    isc_a: float
    test_current_a: float        # 1.35 × Isc
    duration_h: float            # 1-2 h, per spec
    temp_samples: List[RCOTempSample]
    thermal_image_ref: str       # path/URL of IR snapshot
    thermocouple_points: List[Tuple[str, float]]   # (location_label, peak_t_c)
    max_allowed_t_c: float


# ---------------------------------------------------------------------------
# 7. Ground Continuity — IEC 61730 MST 13 (and cross-cutting COP/DPTT/IDD)
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class GCTPathSample:
    t_min: float
    voltage_v: float
    current_a: float


@dataclass(frozen=True)
class GCTPath:
    label: str                   # e.g. "Frame corner → J-box (shortest)"
    resistance_ohm: float
    samples: List[GCTPathSample]


@dataclass(frozen=True)
class GCTSection:
    clause: str
    frame_current_target_a: float
    frame_current_tolerance_a: float
    max_resistance_ohm: float    # 0.1 Ω per MST 13
    shortest: GCTPath
    longest: GCTPath


# ---------------------------------------------------------------------------
# 8. Electroluminescence — IEC TS 60904-13 (+ IEA PVPS, MBJ)
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class ELSection:
    clause: str
    camera: str
    lens_mm: float
    exposure_s: float
    current_a: float
    psu_voltage_v: float
    psu_setting: str
    defect_index: float          # IEC 60904-13 / IEA PVPS
    defect_index_threshold: float
    defect_criteria: List[str]   # bullets from IEC 60904-13 / IEA PVPS
    detected_defects: List[str]
    mbj_passed: bool
    mbj_criteria: str


# ---------------------------------------------------------------------------
# 9. Inverted IR Thermography
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class IIRSection:
    clause: str
    camera: str
    lens_mm: float
    current_a: float
    psu_voltage_v: float
    psu_setting: str
    emissivity: float
    ambient_t_c: float
    soak_min: float
    grid_t_c: List[List[float]]  # 2-D temperature grid for the heatmap


# ---------------------------------------------------------------------------
# 10. Power Generation
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class PowerGenPoint:
    t_min: float
    pmax_w: float
    voc_v: float
    isc_a: float
    ff: float
    vmp_v: float
    imp_a: float


@dataclass(frozen=True)
class PowerGenEnv:
    t_min: float
    irradiance_w_m2: float
    module_t_c: float
    ambient_t_c: float


@dataclass(frozen=True)
class PowerGenSection:
    samples: List[PowerGenPoint]
    env: List[PowerGenEnv]
    standard: str = "Time-series IV-curve sweep · environmental log"


# ---------------------------------------------------------------------------
# Deterministic synthetic generators (no RNG). Shaped to look like real runs.
# ---------------------------------------------------------------------------

def gen_tc(n: int = 60, position: str = "Bifacial") -> TCSection:
    """One TC cycle (-40 ↔ +85 °C with 10-min dwells), realistic ramp."""
    samples: List[TCSample] = []
    for k in range(n):
        f = k / max(n - 1, 1)
        # Triangle wave between -40 and +85, period = 60 min.
        phase = (f * 60.0) % 60.0
        if phase < 30.0:
            t = -40.0 + (125.0 / 30.0) * phase
        else:
            t = 85.0 - (125.0 / 30.0) * (phase - 30.0)
        # Clamp dwells around extremes.
        if phase < 5.0:
            t = -40.0
        elif 25.0 < phase < 35.0:
            t = 85.0
        elif phase > 55.0:
            t = -40.0
        # Isc current injection only when T > 25 °C.
        i = 9.21 if t > 25.0 else 0.0
        samples.append(TCSample(round(f * 60.0, 2), round(t, 2), round(i, 3)))
    # Mass-loading per BNBI/BSI/Bifacial varies — bifacial gets larger J-box.
    mass = {"Bifacial": 1.40, "BSI": 0.95, "BNBI": 0.95}.get(position, 1.10)
    return TCSection(
        clause="IEC 61215-2 MQT 11",
        position=position,
        jbox_mass_kg=mass,
        schematic_ref="docs/jbox_mass_loading.svg",
        samples=samples,
        set_ramp_c_per_min=100.0 / 60.0,
        temp_range_c=(-40.0, 85.0),
        dwell_min_min=10.0,
        tolerance_temp_c=2.0,
        tolerance_ramp_c_per_min=0.5,
    )


def gen_hf(n: int = 48, ramp_mode_c_per_h: int = 100) -> HFSection:
    """HF cycle: 85 °C / 85 %RH plateau then ramp to -40 °C, return."""
    samples: List[HFSample] = []
    for k in range(n):
        f = k / max(n - 1, 1)
        if f < 0.5:
            t = 85.0 - (125.0 * 2.0 * f)        # 85 → -40 over first half
            rh = 85.0 - 30.0 * (2.0 * f)         # RH drops with T
        else:
            t = -40.0 + (125.0 * 2.0 * (f - 0.5))
            rh = 55.0 + 30.0 * (2.0 * (f - 0.5))
        current = 0.0091 * (1.0 + 0.001 * math.sin(f * 4 * math.pi))  # ~9.1 mA
        samples.append(HFSample(round(f * 60.0, 2), round(t, 2), round(rh, 2), round(current, 5)))
    return HFSection(
        clause="IEC 61215-2 MQT 12",
        ramp_mode_c_per_h=ramp_mode_c_per_h,
        samples=samples,
        set_ramp_c_per_min=ramp_mode_c_per_h / 60.0,
        tolerance_temp_c=2.0,
        tolerance_rh_pct=5.0,
        tolerance_current_pct=0.1,
        uniformity_t_c=1.5,
        uniformity_rh_pct=3.0,
    )


def gen_pid(n: int = 60, stabilization_h: float = 18.0) -> PIDSection:
    """T+RH sit at 85/85 then settle; small leakage ramp post-stab."""
    samples: List[PIDSample] = []
    for k in range(n):
        f = k / max(n - 1, 1)
        t_h = f * 48.0                                # 48 h total
        # Pre-stab ringing, then flat.
        t_c = 85.0 + 1.5 * math.exp(-t_h / 4.0) * math.sin(t_h * 1.5)
        rh = 85.0 + 1.0 * math.exp(-t_h / 4.0) * math.cos(t_h * 1.5)
        # Leakage rises slowly post-stabilization.
        leakage = 1.2e-6 + (5.0e-6 if t_h > stabilization_h else 0.0) * (t_h - stabilization_h) / 30.0
        leakage = max(leakage, 1.2e-6)
        samples.append(PIDSample(round(t_h * 60.0, 2), round(t_c, 3), round(rh, 3), round(leakage, 9)))
    return PIDSection(
        clause="IEC TS 62804-1",
        samples=samples,
        stabilization_h=stabilization_h,
        t_tolerance_c=2.0,
        rh_tolerance_pct=5.0,
        leakage_threshold_a=10e-6,
        post_stab_t_tolerance_c=1.0,
        post_stab_rh_tolerance_pct=2.0,
        setpoint_t_c=85.0,
        setpoint_rh_pct=85.0,
    )


def gen_letid(n: int = 48) -> LeTIDSection:
    """Module T pinned at 75 °C, dark V_oc decays exponentially under Isc-Imp."""
    samples: List[LeTIDSample] = []
    v0 = 0.642
    for k in range(n):
        f = k / max(n - 1, 1)
        t_h = f * 162.0
        v = v0 - 0.018 * (1.0 - math.exp(-t_h / 40.0))  # decay then plateau
        samples.append(LeTIDSample(round(t_h * 60.0, 2), 75.0, round(v, 5), 4.65))
    return LeTIDSection(
        clause="IEC TS 63342:2022",
        samples=samples,
        stop_criteria="162 h elapsed AND |ΔV_oc/Δt| < 1 µV/h over last 6 h",
        uncertainty_t_c=0.5,
        uncertainty_voltage_v=0.0005,
        uncertainty_current_a=0.010,
    )


def gen_rco(n: int = 36) -> RCOSection:
    """Forward-bias at 1.35×Isc for ~2 h, module T rises and plateaus."""
    isc = 9.21
    test_current = 1.35 * isc
    samples: List[RCOTempSample] = []
    for k in range(n):
        f = k / max(n - 1, 1)
        t_h = f * 2.0
        mod_t = 25.0 + 38.0 * (1.0 - math.exp(-t_h * 1.6))
        samples.append(RCOTempSample(round(t_h * 60.0, 2), round(mod_t, 2)))
    return RCOSection(
        clause="IEC 61730 MST 26",
        isc_a=isc,
        test_current_a=round(test_current, 3),
        duration_h=2.0,
        temp_samples=samples,
        thermal_image_ref="evidence/rco_ir_t60min.png",
        thermocouple_points=[
            ("TC1 — back-sheet centre", 64.2),
            ("TC2 — J-box", 71.8),
            ("TC3 — frame", 38.5),
        ],
        max_allowed_t_c=130.0,
    )


def gen_gct(n: int = 24) -> GCTSection:
    """Two paths: shortest (frame corner) and longest (corner-to-corner)."""
    def path(n_pts: int, r_ohm: float, label: str) -> GCTPath:
        s: List[GCTPathSample] = []
        target_i = 25.0
        for k in range(n_pts):
            f = k / max(n_pts - 1, 1)
            i = target_i * (1.0 + 0.001 * math.sin(f * 6 * math.pi))
            v = i * r_ohm
            s.append(GCTPathSample(round(f * 6.0, 2), round(v, 4), round(i, 3)))
        return GCTPath(label=label, resistance_ohm=r_ohm, samples=s)
    return GCTSection(
        clause="IEC 61730-2 MST 13",
        frame_current_target_a=25.0,
        frame_current_tolerance_a=0.5,
        max_resistance_ohm=0.1,
        shortest=path(n, 0.018, "Frame corner ↔ adjacent corner (shortest)"),
        longest=path(n, 0.072, "Frame corner ↔ opposite corner (longest)"),
    )


def gen_el() -> ELSection:
    """EL metadata + defect index (IEC 60904-13)."""
    return ELSection(
        clause="IEC TS 60904-13",
        camera="Greateyes GE-VAC 2048 256BI · cooled InGaAs",
        lens_mm=50.0,
        exposure_s=8.0,
        current_a=9.21,
        psu_voltage_v=42.7,
        psu_setting="constant-current 9.21 A · clamp 50 V",
        defect_index=0.034,
        defect_index_threshold=0.05,
        defect_criteria=[
            "Crack (any length) — IEC 60904-13 §6.2",
            "Inactive cell area ≥ 8 % — IEC 60904-13 §6.3",
            "Finger interruptions ≥ 25 % — IEA PVPS T13-24",
            "Ribbon disconnection — IEA PVPS T13-24",
        ],
        detected_defects=["1 inactive cell (#42, ~5 % area)"],
        mbj_passed=True,
        mbj_criteria="Per IEC 60904-13 Multi-Busbar (MBJ): no shaded busbar ≥ 3 mm; no disconnection of ≥ 2 ribbons per cell.",
    )


def gen_iir(rows: int = 12, cols: int = 24) -> IIRSection:
    """Inverted IR heatmap — Gaussian hot-spots over the module grid."""
    grid: List[List[float]] = []
    hotspots = [(4, 18, 12.0), (8, 6, 6.0)]
    for r in range(rows):
        row: List[float] = []
        for c in range(cols):
            base = 42.0 + 2.0 * math.cos(c / cols * 2 * math.pi) + 1.0 * math.sin(r / rows * 2 * math.pi)
            extra = 0.0
            for (hr, hc, amp) in hotspots:
                d2 = (r - hr) ** 2 + (c - hc) ** 2
                extra += amp * math.exp(-d2 / 6.0)
            row.append(round(base + extra, 2))
        grid.append(row)
    return IIRSection(
        clause="Forward-bias IR thermography",
        camera="FLIR T540 · 464×348 px",
        lens_mm=42.0,
        current_a=9.21,
        psu_voltage_v=42.7,
        psu_setting="constant-current 9.21 A · soak 30 min",
        emissivity=0.95,
        ambient_t_c=24.0,
        soak_min=30.0,
        grid_t_c=grid,
    )


def gen_powergen(n: int = 36) -> PowerGenSection:
    """Realistic Pmax/Voc/Isc/FF/Vmp/Imp curves under varying irradiance."""
    pts: List[PowerGenPoint] = []
    env: List[PowerGenEnv] = []
    for k in range(n):
        f = k / max(n - 1, 1)
        t_h = f * 6.0
        # Bell-curve irradiance over the test window.
        irr = 1000.0 * math.exp(-((t_h - 3.0) ** 2) / 6.0)
        mod_t = 25.0 + 30.0 * (irr / 1000.0)
        amb = 22.0 + 8.0 * math.sin(f * math.pi)
        env.append(PowerGenEnv(round(t_h * 60.0, 2), round(irr, 1), round(mod_t, 2), round(amb, 2)))
        # IV: Isc ∝ irradiance; Voc depends on T (~ -0.32 % /°C); FF ~ 0.78.
        isc = 9.21 * (irr / 1000.0)
        voc = 49.2 * (1.0 - 0.0032 * (mod_t - 25.0))
        ff = 0.78 - 0.0006 * (mod_t - 25.0)
        pmax = max(0.0, isc * voc * ff)
        vmp = voc * 0.82
        imp = (pmax / vmp) if vmp > 0 else 0.0
        pts.append(PowerGenPoint(
            round(t_h * 60.0, 2),
            round(pmax, 2), round(voc, 3), round(isc, 3), round(ff, 4),
            round(vmp, 3), round(imp, 3),
        ))
    return PowerGenSection(samples=pts, env=env)
