"""Render a :class:`ReportRun` to its HTML twin and to PDF.

The PDF is produced by WeasyPrint from the very same HTML the ``/html``
endpoint serves, so the two formats are one source of truth — a true twin.
The traceability footer (module · run · git · page n/N) lives in the
template's ``@page`` CSS. Heavy deps (matplotlib, weasyprint, jinja2) are
imported lazily so importing the package stays cheap.
"""
from __future__ import annotations

import base64
import functools
import subprocess
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import Dict

from .fixtures import ReportRun, TestBlock

try:
    from ...config import get_settings
except ImportError:  # pragma: no cover - script-mode fallback
    from config import get_settings  # type: ignore[no-redef]

TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"
BRAND = "Shreshtata Power Supplies"
_IST = timezone(timedelta(hours=5, minutes=30))

_PASS = "#15803d"
_FAIL = "#b91c1c"
_INCON = "#b45309"


def verdict_color(verdict: str) -> str:
    return {"PASS": _PASS, "FAIL": _FAIL}.get(verdict, _INCON)


@functools.lru_cache(maxsize=1)
def git_sha() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=Path(__file__).resolve().parents[3],
            capture_output=True, text=True, timeout=3,
        )
        if out.stdout.strip():
            return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):  # pragma: no cover
        pass
    return "unknown"


def _meta() -> Dict[str, str]:
    s = get_settings()
    return {
        "brand": BRAND,
        "git_sha": git_sha(),
        "version": s.APP_VERSION,
        "banner": "DEMO" if s.DEMO_MODE else "LIVE",
        "generated_at": datetime.now(_IST).strftime("%Y-%m-%d %H:%M:%S IST"),
    }


def _overlay_png(block: TestBlock) -> bytes:
    """Dual-axis overlay: chamber T/RH (left) vs module I/V (right)."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    w = block.window
    xs = [p.t_min for p in w]
    fig, ax1 = plt.subplots(figsize=(7.0, 2.6), dpi=110)
    ax1.plot(xs, [p.chamber_t_c for p in w], color=_FAIL, lw=1.4, label="Chamber T (°C)")
    ax1.plot(xs, [p.chamber_rh_pct for p in w], color="#2563eb", lw=1.4, label="Chamber RH (%)")
    ax1.set_xlabel("Elapsed (min)")
    ax1.set_ylabel("Chamber T (°C) / RH (%)")
    ax1.grid(True, alpha=0.25)
    ax2 = ax1.twinx()
    ax2.plot(xs, [p.module_i_a for p in w], color="#f59e0b", lw=1.4, label="Module I (A)")
    ax2.plot(xs, [p.module_v_v for p in w], color=_PASS, lw=1.4, label="Module V (V)")
    ax2.set_ylabel("Module I (A) / V (V)")
    h1, l1 = ax1.get_legend_handles_labels()
    h2, l2 = ax2.get_legend_handles_labels()
    ax1.legend(h1 + h2, l1 + l2, loc="upper right", fontsize=6, ncol=2)
    fig.suptitle(f"{block.name} — chamber vs module telemetry", fontsize=9)
    fig.tight_layout()
    buf = BytesIO()
    fig.savefig(buf, format="png")
    plt.close(fig)
    return buf.getvalue()


def render_html(run: ReportRun) -> str:
    from jinja2 import Environment, FileSystemLoader, select_autoescape

    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=select_autoescape(["html"]),
    )
    env.filters["vcolor"] = verdict_color
    charts = {b.key: base64.b64encode(_overlay_png(b)).decode("ascii") for b in run.tests}
    return env.get_template("report.html").render(run=run, charts=charts, meta=_meta())


def render_pdf(run: ReportRun) -> bytes:
    """PDF twin — WeasyPrint renders the same HTML the /html endpoint serves."""
    from weasyprint import HTML

    return HTML(string=render_html(run)).write_pdf()
