"""Per-section matplotlib chart helpers.

Each helper takes the dataclass from ``sections`` and returns PNG bytes
ready to be base64-encoded into the HTML template (and via WeasyPrint, the
PDF). matplotlib is imported lazily by ``_fig`` so importing this module
without rendering stays cheap.
"""
from __future__ import annotations

from io import BytesIO
from typing import Iterable, List, Tuple

from . import sections as sec


_PASS = "#15803d"
_FAIL = "#b91c1c"
_INFO = "#2563eb"
_AMBER = "#f59e0b"
_GREY = "#475569"


def _fig(figsize: Tuple[float, float] = (7.0, 2.6), dpi: int = 110):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    return plt, plt.figure(figsize=figsize, dpi=dpi)


def _to_png(fig) -> bytes:
    import matplotlib.pyplot as plt
    fig.tight_layout()
    buf = BytesIO()
    fig.savefig(buf, format="png")
    plt.close(fig)
    return buf.getvalue()


def _band(ax, lo: float, hi: float, label: str | None = None) -> None:
    ax.axhspan(lo, hi, color="#10b981", alpha=0.08, label=label)


# ---------------------------------------------------------------------------
# 1. TC — time series (T + I) and ramp panel (SET vs ACTUAL · p2p + cumulative)
# ---------------------------------------------------------------------------

def tc_time_series_png(s: sec.TCSection) -> bytes:
    plt, fig = _fig()
    ax1 = fig.add_subplot(111)
    xs = [p.t_min for p in s.samples]
    ax1.plot(xs, [p.mod_t_c for p in s.samples], color=_FAIL, lw=1.6, label="Module T (°C)")
    lo, hi = s.temp_range_c
    _band(ax1, lo - s.tolerance_temp_c, hi + s.tolerance_temp_c, label=f"Tolerance band ±{s.tolerance_temp_c} °C")
    ax1.set_xlabel("Elapsed (min)")
    ax1.set_ylabel("Module T (°C)")
    ax1.grid(True, alpha=0.25)
    ax2 = ax1.twinx()
    ax2.plot(xs, [p.current_a for p in s.samples], color=_AMBER, lw=1.4, label="Injected I (A)")
    ax2.set_ylabel("Injected current (A)")
    h1, l1 = ax1.get_legend_handles_labels()
    h2, l2 = ax2.get_legend_handles_labels()
    ax1.legend(h1 + h2, l1 + l2, loc="upper right", fontsize=6, ncol=2)
    fig.suptitle("TC — module T and injected current (one cycle)", fontsize=9)
    return _to_png(fig)


def tc_ramp_panel_png(s: sec.TCSection) -> bytes:
    plt, fig = _fig(figsize=(7.0, 3.0))
    ax = fig.add_subplot(111)
    pt = s.actual_ramp_pt
    cum = s.actual_ramp_cum
    ax.plot([t for t, _ in pt], [r for _, r in pt], color=_FAIL, lw=1.3, label="ACTUAL · point-to-point")
    ax.plot([t for t, _ in cum], [r for _, r in cum], color=_INFO, lw=1.3, label="ACTUAL · cumulative")
    setv = s.set_ramp_c_per_min
    ax.axhline(setv, color=_PASS, lw=1.2, ls="--", label=f"SET {setv:.2f} °C/min")
    ax.axhline(-setv, color=_PASS, lw=1.2, ls="--")
    band = s.tolerance_ramp_c_per_min
    ax.fill_between([t for t, _ in pt], setv - band, setv + band, color=_PASS, alpha=0.10)
    ax.fill_between([t for t, _ in pt], -setv - band, -setv + band, color=_PASS, alpha=0.10)
    ax.set_xlabel("Elapsed (min)")
    ax.set_ylabel("Ramp rate (°C/min)")
    ax.grid(True, alpha=0.25)
    ax.legend(loc="upper right", fontsize=6, ncol=2)
    fig.suptitle("TC — ramp rate · SET vs ACTUAL (point-to-point and cumulative)", fontsize=9)
    return _to_png(fig)


# ---------------------------------------------------------------------------
# 2. HF — combined T+RH+I and ramp panel
# ---------------------------------------------------------------------------

def hf_combined_png(s: sec.HFSection) -> bytes:
    plt, fig = _fig(figsize=(7.0, 3.0))
    ax1 = fig.add_subplot(111)
    xs = [p.t_min for p in s.samples]
    ax1.plot(xs, [p.mod_t_c for p in s.samples], color=_FAIL, lw=1.5, label="Module T (°C)")
    ax1.plot(xs, [p.rh_pct for p in s.samples], color=_INFO, lw=1.5, label="Chamber RH (%)")
    ax1.set_xlabel("Elapsed (min)")
    ax1.set_ylabel("T (°C) / RH (%)")
    ax1.grid(True, alpha=0.25)
    ax2 = ax1.twinx()
    ax2.plot(xs, [p.current_a * 1000.0 for p in s.samples], color=_AMBER, lw=1.3, label="Injected I (mA)")
    ax2.set_ylabel("Injected current (mA)")
    h1, l1 = ax1.get_legend_handles_labels()
    h2, l2 = ax2.get_legend_handles_labels()
    ax1.legend(h1 + h2, l1 + l2, loc="upper right", fontsize=6, ncol=2)
    fig.suptitle(f"HF — T, RH, injected current (ramp mode {s.ramp_mode_c_per_h} °C/h)", fontsize=9)
    return _to_png(fig)


def hf_ramp_panel_png(s: sec.HFSection) -> bytes:
    plt, fig = _fig()
    ax = fig.add_subplot(111)
    pt = s.actual_ramp_pt
    cum = s.actual_ramp_cum
    ax.plot([t for t, _ in pt], [r for _, r in pt], color=_FAIL, lw=1.3, label="ACTUAL · point-to-point")
    ax.plot([t for t, _ in cum], [r for _, r in cum], color=_INFO, lw=1.3, label="ACTUAL · cumulative")
    setv = s.set_ramp_c_per_min
    ax.axhline(setv, color=_PASS, lw=1.2, ls="--", label=f"SET {setv:.2f} °C/min ({s.ramp_mode_c_per_h} °C/h)")
    ax.axhline(-setv, color=_PASS, lw=1.2, ls="--")
    ax.set_xlabel("Elapsed (min)")
    ax.set_ylabel("Ramp rate (°C/min)")
    ax.grid(True, alpha=0.25)
    ax.legend(loc="upper right", fontsize=6, ncol=2)
    fig.suptitle("HF — ramp rate · SET vs ACTUAL", fontsize=9)
    return _to_png(fig)


# ---------------------------------------------------------------------------
# 3. PID — T + RH + leakage
# ---------------------------------------------------------------------------

def pid_chart_png(s: sec.PIDSection) -> bytes:
    plt, fig = _fig(figsize=(7.0, 3.0))
    ax1 = fig.add_subplot(111)
    xs_h = [p.t_min / 60.0 for p in s.samples]
    ax1.plot(xs_h, [p.chamber_t_c for p in s.samples], color=_FAIL, lw=1.4, label="Chamber T (°C)")
    ax1.plot(xs_h, [p.rh_pct for p in s.samples], color=_INFO, lw=1.4, label="Chamber RH (%)")
    ax1.axvline(s.stabilization_h, color=_GREY, lw=1.0, ls=":", label=f"Stabilization @ {s.stabilization_h:.1f} h")
    ax1.set_xlabel("Elapsed (h)")
    ax1.set_ylabel("T (°C) / RH (%)")
    ax1.grid(True, alpha=0.25)
    ax2 = ax1.twinx()
    ax2.plot(xs_h, [p.leakage_a * 1e6 for p in s.samples], color=_AMBER, lw=1.4, label="Leakage (µA)")
    ax2.axhline(s.leakage_threshold_a * 1e6, color=_AMBER, lw=1.0, ls="--", alpha=0.7, label=f"Leakage threshold {s.leakage_threshold_a*1e6:.1f} µA")
    ax2.set_ylabel("Leakage current (µA)")
    h1, l1 = ax1.get_legend_handles_labels()
    h2, l2 = ax2.get_legend_handles_labels()
    ax1.legend(h1 + h2, l1 + l2, loc="upper left", fontsize=6, ncol=2)
    fig.suptitle("PID — T, RH and leakage current (post-stabilization tightened)", fontsize=9)
    return _to_png(fig)


# ---------------------------------------------------------------------------
# 4. LeTID — T + dark V + I
# ---------------------------------------------------------------------------

def letid_chart_png(s: sec.LeTIDSection) -> bytes:
    plt, fig = _fig(figsize=(7.0, 3.0))
    ax1 = fig.add_subplot(111)
    xs_h = [p.t_min / 60.0 for p in s.samples]
    ax1.plot(xs_h, [p.mod_t_c for p in s.samples], color=_FAIL, lw=1.4, label="Module T (°C)")
    ax1.plot(xs_h, [p.dark_v_v * 1000.0 for p in s.samples], color="#7c3aed", lw=1.4, label="Dark V_oc (mV)")
    ax1.set_xlabel("Elapsed (h)")
    ax1.set_ylabel("T (°C) / Dark V_oc (mV)")
    ax1.grid(True, alpha=0.25)
    ax2 = ax1.twinx()
    ax2.plot(xs_h, [p.current_a for p in s.samples], color=_AMBER, lw=1.3, label="Injected I (A)")
    ax2.set_ylabel("Injected current (A)")
    h1, l1 = ax1.get_legend_handles_labels()
    h2, l2 = ax2.get_legend_handles_labels()
    ax1.legend(h1 + h2, l1 + l2, loc="upper right", fontsize=6, ncol=2)
    fig.suptitle("LeTID — module T, dark V_oc, injected current", fontsize=9)
    return _to_png(fig)


# ---------------------------------------------------------------------------
# 6. RCO — module T trace + thermocouple peaks
# ---------------------------------------------------------------------------

def rco_temp_trace_png(s: sec.RCOSection) -> bytes:
    plt, fig = _fig(figsize=(7.0, 2.7))
    ax = fig.add_subplot(111)
    xs = [p.t_min for p in s.temp_samples]
    ax.plot(xs, [p.mod_t_c for p in s.temp_samples], color=_FAIL, lw=1.6, label="Module T (°C)")
    ax.axhline(s.max_allowed_t_c, color=_AMBER, lw=1.0, ls="--", label=f"Max allowed {s.max_allowed_t_c:.0f} °C")
    # Plot thermocouple peaks at the end of the window for a visual summary.
    end = xs[-1] if xs else 0.0
    for i, (label, t_c) in enumerate(s.thermocouple_points):
        ax.scatter([end], [t_c], color=_INFO, zorder=5)
        ax.annotate(f"{label}: {t_c:.1f} °C", (end, t_c), fontsize=6,
                    xytext=(-8, 6 + 8 * i), textcoords="offset points")
    ax.set_xlabel("Elapsed (min)")
    ax.set_ylabel("Temperature (°C)")
    ax.grid(True, alpha=0.25)
    ax.legend(loc="lower right", fontsize=6)
    fig.suptitle(f"RCO — module T at {s.test_current_a:.2f} A (1.35×Isc) over {s.duration_h:g} h", fontsize=9)
    return _to_png(fig)


# ---------------------------------------------------------------------------
# 7. GCT — frame current + V/I per path
# ---------------------------------------------------------------------------

def gct_chart_png(s: sec.GCTSection) -> bytes:
    plt, fig = _fig(figsize=(7.0, 3.0))
    ax1 = fig.add_subplot(111)
    for path, colour in ((s.shortest, _PASS), (s.longest, _FAIL)):
        xs = [p.t_min for p in path.samples]
        ax1.plot(xs, [p.current_a for p in path.samples], color=colour, lw=1.4,
                 label=f"{path.label} · I (A) · R={path.resistance_ohm:.4f} Ω")
    ax1.axhline(s.frame_current_target_a, color=_GREY, lw=1.0, ls="--",
                label=f"Target {s.frame_current_target_a:.1f} A ±{s.frame_current_tolerance_a:.2f}")
    ax1.fill_between([0, max(p.t_min for p in s.shortest.samples)],
                     s.frame_current_target_a - s.frame_current_tolerance_a,
                     s.frame_current_target_a + s.frame_current_tolerance_a,
                     color=_GREY, alpha=0.10)
    ax1.set_xlabel("Elapsed (min)")
    ax1.set_ylabel("Frame injection current (A)")
    ax1.grid(True, alpha=0.25)
    ax1.legend(loc="lower right", fontsize=6)
    fig.suptitle("GCT — frame current per path (shortest vs longest)", fontsize=9)
    return _to_png(fig)


# ---------------------------------------------------------------------------
# 9. IIR — temperature heatmap
# ---------------------------------------------------------------------------

def iir_heatmap_png(s: sec.IIRSection) -> bytes:
    plt, fig = _fig(figsize=(7.0, 3.6))
    ax = fig.add_subplot(111)
    grid = s.grid_t_c
    im = ax.imshow(grid, cmap="inferno", aspect="auto")
    cbar = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    cbar.set_label("Temperature (°C)", fontsize=7)
    ax.set_xlabel("Column (cell #)")
    ax.set_ylabel("Row")
    ax.set_title(f"IIR — temperature distribution · ε={s.emissivity:.2f} · ambient {s.ambient_t_c:.1f} °C", fontsize=9)
    return _to_png(fig)


# ---------------------------------------------------------------------------
# 10. Power Generation — multi-trace IV + environmental
# ---------------------------------------------------------------------------

def powergen_iv_png(s: sec.PowerGenSection) -> bytes:
    plt, fig = _fig(figsize=(7.0, 3.2))
    ax1 = fig.add_subplot(111)
    xs = [p.t_min for p in s.samples]
    ax1.plot(xs, [p.pmax_w for p in s.samples], color=_FAIL, lw=1.6, label="Pmax (W)")
    ax1.plot(xs, [p.voc_v for p in s.samples], color=_INFO, lw=1.3, label="Voc (V)")
    ax1.plot(xs, [p.vmp_v for p in s.samples], color="#7c3aed", lw=1.2, ls="--", label="Vmp (V)")
    ax1.set_xlabel("Elapsed (min)")
    ax1.set_ylabel("Pmax (W) · Voc / Vmp (V)")
    ax1.grid(True, alpha=0.25)
    ax2 = ax1.twinx()
    ax2.plot(xs, [p.isc_a for p in s.samples], color=_AMBER, lw=1.3, label="Isc (A)")
    ax2.plot(xs, [p.imp_a for p in s.samples], color="#ea580c", lw=1.2, ls="--", label="Imp (A)")
    ax2.plot(xs, [p.ff for p in s.samples], color=_PASS, lw=1.1, label="FF (×1)")
    ax2.set_ylabel("Isc / Imp (A) · FF")
    h1, l1 = ax1.get_legend_handles_labels()
    h2, l2 = ax2.get_legend_handles_labels()
    ax1.legend(h1 + h2, l1 + l2, loc="upper right", fontsize=6, ncol=3)
    fig.suptitle("Power Generation — Pmax · Voc · Isc · FF · Vmp · Imp over time", fontsize=9)
    return _to_png(fig)


def powergen_env_png(s: sec.PowerGenSection) -> bytes:
    plt, fig = _fig(figsize=(7.0, 2.4))
    ax1 = fig.add_subplot(111)
    xs = [p.t_min for p in s.env]
    ax1.plot(xs, [p.irradiance_w_m2 for p in s.env], color=_AMBER, lw=1.4, label="Irradiance (W/m²)")
    ax1.set_xlabel("Elapsed (min)")
    ax1.set_ylabel("Irradiance (W/m²)")
    ax1.grid(True, alpha=0.25)
    ax2 = ax1.twinx()
    ax2.plot(xs, [p.module_t_c for p in s.env], color=_FAIL, lw=1.3, label="Module T (°C)")
    ax2.plot(xs, [p.ambient_t_c for p in s.env], color=_INFO, lw=1.2, ls="--", label="Ambient T (°C)")
    ax2.set_ylabel("Temperature (°C)")
    h1, l1 = ax1.get_legend_handles_labels()
    h2, l2 = ax2.get_legend_handles_labels()
    ax1.legend(h1 + h2, l1 + l2, loc="upper right", fontsize=6, ncol=2)
    fig.suptitle("Power Generation — environmental conditions", fontsize=9)
    return _to_png(fig)


# ---------------------------------------------------------------------------
# Aggregator — bundle every PNG for one run, keyed for the template.
# ---------------------------------------------------------------------------

def render_all(run) -> dict:
    """Return ``{chart_key: png_bytes}`` for every section present in ``run``."""
    out: dict = {}
    if run.tc is not None:
        out["tc_ts"] = tc_time_series_png(run.tc)
        out["tc_ramp"] = tc_ramp_panel_png(run.tc)
    if run.hf is not None:
        out["hf_combined"] = hf_combined_png(run.hf)
        out["hf_ramp"] = hf_ramp_panel_png(run.hf)
    if run.pid is not None:
        out["pid"] = pid_chart_png(run.pid)
    if run.letid is not None:
        out["letid_ext"] = letid_chart_png(run.letid)
    if run.rco is not None:
        out["rco_temp"] = rco_temp_trace_png(run.rco)
    if run.gct is not None:
        out["gct_ext"] = gct_chart_png(run.gct)
    if run.iir is not None:
        out["iir_heatmap"] = iir_heatmap_png(run.iir)
    if run.powergen is not None:
        out["powergen_iv"] = powergen_iv_png(run.powergen)
        out["powergen_env"] = powergen_env_png(run.powergen)
    return out
