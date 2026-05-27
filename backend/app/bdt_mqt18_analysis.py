"""IEC 61215-2:2021 MQT 18.1 — Bypass Diode Thermal Test: analysis.

Per-diode linear regression of forward voltage drop V_D against junction
temperature T_j (via numpy.polyfit), an IEC 61215-2 4.18.3 PASS/FAIL
verdict, a saved V_D-vs-T_j plot per diode, and a DEMO-mode data
synthesizer (slope ~ -2 mV/C plus Gaussian noise). No PSU/IV acquisition
happens here.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional, Sequence, Tuple

import numpy as np

# IEC 61215-2 4.18.3: through the 1 h hold at 1.25 x Isc the diode must
# conduct and its junction temperature stay at/below Tj,max. Configurable;
# 200 C is the default device rating.
DEFAULT_TJ_MAX_C: float = 200.0
DEMO_SLOPE_MV_PER_C: float = -2.0  # typical bypass-diode dV_f/dT_j
DEMO_INTERCEPT_V: float = 0.85
DEMO_NOISE_V: float = 0.005

PASS = "PASS"
FAIL = "FAIL"


@dataclass(frozen=True)
class DiodeRegression:
    diode_id: str
    slope_mV_per_C: float
    intercept_V: float
    r_squared: float
    tj_max_observed_c: float
    verdict: str


def regress_vd_vs_tj(
    tj_c: Sequence[float], vd_v: Sequence[float]
) -> Tuple[float, float, float]:
    """Least-squares fit V_D = m*T_j + b via numpy.polyfit.

    Returns (slope_mV_per_C, intercept_V, r_squared). Needs >= 2 samples
    spanning a range of T_j.
    """
    tj = np.asarray(tj_c, dtype=float)
    vd = np.asarray(vd_v, dtype=float)
    if tj.size < 2 or np.ptp(tj) == 0:
        raise ValueError("need >= 2 samples spanning a range of T_j")

    slope_v, intercept = np.polyfit(tj, vd, 1)
    fitted = slope_v * tj + intercept
    ss_res = float(np.sum((vd - fitted) ** 2))
    ss_tot = float(np.sum((vd - vd.mean()) ** 2))
    r_squared = 1.0 if ss_tot == 0.0 else 1.0 - ss_res / ss_tot
    return float(slope_v * 1000.0), float(intercept), float(r_squared)


def diode_verdict(
    tj_max_observed_c: float,
    *,
    tj_max_c: float = DEFAULT_TJ_MAX_C,
    conducts: bool = True,
) -> str:
    """IEC 61215-2 4.18.3 verdict: PASS iff the diode conducted at 1.25 x Isc
    through the 1 h hold and never exceeded ``tj_max_c``; else FAIL."""
    return PASS if (conducts and tj_max_observed_c <= tj_max_c) else FAIL


def analyse_diode(
    diode_id: str,
    tj_c: Sequence[float],
    vd_v: Sequence[float],
    *,
    tj_max_c: float = DEFAULT_TJ_MAX_C,
    conducts: bool = True,
) -> DiodeRegression:
    slope, intercept, r2 = regress_vd_vs_tj(tj_c, vd_v)
    tj_obs = float(np.max(np.asarray(tj_c, dtype=float)))
    return DiodeRegression(
        diode_id=diode_id,
        slope_mV_per_C=slope,
        intercept_V=intercept,
        r_squared=r2,
        tj_max_observed_c=tj_obs,
        verdict=diode_verdict(tj_obs, tj_max_c=tj_max_c, conducts=conducts),
    )


def data_table_row(reg: DiodeRegression) -> Dict[str, object]:
    """One Data Table row per diode (columns per the acceptance criteria)."""
    return {
        "diode_id": reg.diode_id,
        "slope_mV_per_C": round(reg.slope_mV_per_C, 4),
        "R_squared": round(reg.r_squared, 4),
        "Tj_max_observed_C": round(reg.tj_max_observed_c, 2),
        "verdict": reg.verdict,
    }


def synthesize_demo_diode(
    *,
    slope_mV_per_C: float = DEMO_SLOPE_MV_PER_C,
    intercept_V: float = DEMO_INTERCEPT_V,
    tj_c: Optional[Sequence[float]] = None,
    noise_v: float = DEMO_NOISE_V,
    seed: Optional[int] = None,
) -> Tuple[np.ndarray, np.ndarray]:
    """DEMO_MODE: synthesize (T_j, V_D) with slope ~ -2 mV/C + Gaussian noise."""
    tj = np.linspace(30.0, 90.0, 13) if tj_c is None else np.asarray(tj_c, dtype=float)
    rng = np.random.default_rng(seed)
    vd = intercept_V + (slope_mV_per_C / 1000.0) * tj + rng.normal(0.0, noise_v, tj.size)
    return tj, vd


def plot_diode(
    diode_id: str,
    tj_c: Sequence[float],
    vd_v: Sequence[float],
    reg: DiodeRegression,
    session_id: str,
    base_dir: Path | str = ".",
) -> Path:
    """Scatter V_D vs T_j + fit line; save PNG to
    tests/bdt/<sessionId>/plots/diode_<id>.png and return its path."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    tj = np.asarray(tj_c, dtype=float)
    vd = np.asarray(vd_v, dtype=float)
    out_dir = Path(base_dir) / "tests" / "bdt" / session_id / "plots"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"diode_{diode_id}.png"

    fig, ax = plt.subplots(figsize=(5, 3.5))
    ax.scatter(tj, vd, s=18, label="measured")
    xs = np.array([tj.min(), tj.max()])
    ys = (reg.slope_mV_per_C / 1000.0) * xs + reg.intercept_V
    ax.plot(xs, ys, "r-", label=f"fit {reg.slope_mV_per_C:.2f} mV/C, R2={reg.r_squared:.3f}")
    ax.set_xlabel("T_j (C)")
    ax.set_ylabel("V_D (V)")
    ax.set_title(f"Diode {diode_id} - {reg.verdict}")
    ax.legend(loc="best", fontsize=8)
    fig.tight_layout()
    fig.savefig(path, dpi=100)
    plt.close(fig)
    return path
