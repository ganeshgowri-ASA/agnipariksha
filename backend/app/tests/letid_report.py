"""LeTID report generator (IEC TS 63342 deliverable).

Produces a serialisable report dict containing:
- Test identification and IEC TS 63342 clause references
- Pmax vs time curve (raw points)
- Fit parameter table
- Environmental log summary
- Pass/fail verdict with the threshold used
- Path to the raw IV-log CSV.

Kept format-agnostic: the dict is written to JSON next to the CSV and
can be rendered to PDF/DOCX by the frontend ReportGenerator. Doing the
heavy lifting in JSON avoids a hard dependency on matplotlib /
reportlab inside the orchestrator hot path.
"""
from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .letid import LeTIDResult


CLAUSE_REFERENCES = {
    "stress_procedure": "IEC TS 63342:2022, clause 6.2 (current injection at 75 °C ± 5 °C)",
    "iv_interrupts": "IEC TS 63342:2022, clause 6.4 (periodic STC IV measurement)",
    "duration": "IEC TS 63342:2022, clause 6.3 (162 h minimum cumulative stress)",
    "acceptance": "IEC TS 63342:2022, clause 7.2 (Pmax loss threshold)",
    "regeneration": "IEC TS 63342:2022, Annex A (regeneration tracking)",
}


def render_report(result: "LeTIDResult") -> dict:
    cfg = result.config
    iv_curve = [
        {
            "elapsed_h": p.elapsed_h,
            "dose_sun_h": p.dose_sun_h,
            "pmpp": p.pmpp,
            "voc": p.voc,
            "isc": p.isc,
            "fill_factor": p.fill_factor,
            "temperature_c": p.temperature_c,
        }
        for p in result.iv_log
    ]
    env_in_tol = sum(1 for s in result.env_log if s.in_tolerance)
    env_total = max(1, len(result.env_log))
    env_summary = {
        "n_samples": len(result.env_log),
        "in_tolerance_fraction": round(env_in_tol / env_total, 4),
        "mean_current_a": round(
            sum(s.current for s in result.env_log) / env_total, 4
        ) if result.env_log else 0.0,
        "mean_temperature_c": round(
            sum(s.temperature_c for s in result.env_log) / env_total, 2
        ) if result.env_log else cfg.temperature_c,
    }

    return {
        "standard": "IEC TS 63342:2022",
        "test_name": "LeTID — Light and elevated Temperature Induced Degradation",
        "session_id": result.session_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "clause_references": CLAUSE_REFERENCES,
        "configuration": {
            "isc_stc_a": cfg.isc_stc,
            "impp_stc_a": cfg.impp_stc,
            "vmpp_stc_v": cfg.vmpp_stc,
            "voc_stc_v": cfg.voc_stc,
            "pmpp_stc_w": cfg.resolve_pmpp(),
            "injection_current_a": cfg.resolve_injection_current(),
            "temperature_c": cfg.temperature_c,
            "temperature_tolerance_c": cfg.temperature_tolerance_c,
            "total_duration_h": cfg.total_duration_h,
            "iv_interval_h": cfg.iv_interval_h,
            "max_allowed_loss_pct": cfg.max_allowed_loss_pct,
        },
        "verdict": {
            "passed": result.passed,
            "max_relative_loss_pct": round(result.max_relative_loss_pct, 4),
            "threshold_pct": cfg.max_allowed_loss_pct,
            "time_to_min_h": round(result.time_to_min_h, 3),
            "regeneration_fraction": round(result.regeneration_fraction, 4),
            "final_dose_sun_h": round(result.final_dose_sun_h, 3),
            "final_elapsed_h": round(result.final_elapsed_h, 3),
        },
        "fit": asdict(result.fit) if result.fit else None,
        "pmax_vs_time": iv_curve,
        "environmental_log_summary": env_summary,
        "raw_csv_path": result.csv_path,
        "notes": list(result.notes),
    }
