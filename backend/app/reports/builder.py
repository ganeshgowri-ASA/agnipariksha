"""Render a :class:`ReportRun` to its HTML twin and to PDF.

Both formats are driven from one context and share the same matplotlib
overlay PNGs, so the HTML page and the PDF are content-identical twins.
Heavy deps (matplotlib, reportlab, jinja2) are imported lazily so merely
importing the package — or hitting the JSON list endpoint — is cheap.
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
        sha = out.stdout.strip()
        if sha:
            return sha
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
    charts = {
        b.key: base64.b64encode(_overlay_png(b)).decode("ascii") for b in run.tests
    }
    return env.get_template("report.html").render(run=run, charts=charts, meta=_meta())


# ---------------------------------------------------------------------------
# PDF — ReportLab Platypus. The traceability footer (module id · run id · git
# sha · page n/N) is drawn on every page by a numbered canvas.
# ---------------------------------------------------------------------------

def _numbered_canvas(footer: str):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas

    class _Canvas(canvas.Canvas):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self._pages: list = []

        def showPage(self) -> None:
            self._pages.append(dict(self.__dict__))
            self._startPage()

        def save(self) -> None:
            total = len(self._pages)
            for i, state in enumerate(self._pages, start=1):
                self.__dict__.update(state)
                self.setFont("Helvetica", 7)
                self.setFillGray(0.4)
                self.drawString(15 * mm, 10 * mm, footer)
                self.drawRightString(A4[0] - 15 * mm, 10 * mm, f"Page {i} of {total}")
                super().showPage()
            super().save()

    return _Canvas


def render_pdf(run: ReportRun) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
    )

    meta = _meta()
    ss = getSampleStyleSheet()
    body = ss["BodyText"]
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], spaceBefore=10, spaceAfter=4)
    small = ParagraphStyle("small", parent=body, fontSize=8, leading=10, textColor=colors.HexColor("#475569"))
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=15 * mm, rightMargin=15 * mm, topMargin=16 * mm, bottomMargin=18 * mm,
        title=f"IEC Report {run.run_id}",
    )
    grid = TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111827")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#fbbf24")),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f1f5f9")]),
    ])
    flow: list = []

    # (1) Cover -------------------------------------------------------------
    banner_c = colors.HexColor("#b45309" if meta["banner"] == "DEMO" else _PASS)
    flow.append(Paragraph(f"<b>{meta['brand']}</b> — PV Module Reliability Test Report", ss["Title"]))
    flow.append(Paragraph(f"IEC-Formatted Report &nbsp;·&nbsp; {run.standard}", small))
    flow.append(Spacer(1, 4))
    banner = Table([[f"{meta['banner']} REPORT"]], colWidths=[180 * mm])
    banner.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), banner_c),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.white),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("FONTSIZE", (0, 0), (-1, -1), 9), ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    flow.append(banner)
    flow.append(Spacer(1, 6))
    cover = [
        ["Module ID", run.module_id, "Run ID", run.run_id],
        ["Test ID", run.test_id, "IEC standard", run.standard],
        ["Operator", run.operator, "Timestamp (IST)", run.timestamp_ist],
        ["Git SHA", meta["git_sha"], "Overall verdict", run.overall],
    ]
    ct = Table(cover, colWidths=[28 * mm, 62 * mm, 30 * mm, 60 * mm])
    ct.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f1f5f9")),
        ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#f1f5f9")),
        ("TEXTCOLOR", (3, 3), (3, 3), verdict_color(run.overall)),
        ("FONTNAME", (3, 3), (3, 3), "Helvetica-Bold"),
    ]))
    flow.append(ct)

    # (2) Test summary table ------------------------------------------------
    flow.append(Paragraph("Test Summary", h2))
    rows = [["Test", "IEC clause", "Verdict", "Measured", "Threshold", "Margin"]]
    for t in run.tests:
        rows.append([t.name, t.clause, t.verdict, t.measured, t.threshold, t.margin])
    st = Table(rows, colWidths=[34 * mm, 40 * mm, 24 * mm, 26 * mm, 26 * mm, 24 * mm], repeatRows=1)
    st.setStyle(grid)
    for i, t in enumerate(run.tests, start=1):
        st.setStyle(TableStyle([
            ("TEXTCOLOR", (2, i), (2, i), verdict_color(t.verdict)),
            ("FONTNAME", (2, i), (2, i), "Helvetica-Bold"),
        ]))
    flow.append(st)

    # (3+4) Per-test overlay graph + detail block ---------------------------
    for t in run.tests:
        block = [
            Paragraph(f"{t.name} &mdash; {t.clause}", h2),
            Image(BytesIO(_overlay_png(t)), width=170 * mm, height=63 * mm),
            Paragraph(t.clause_text, small),
            Paragraph(
                f"<b>Verdict:</b> {t.verdict} &nbsp; <b>Telemetry window:</b> "
                f"{len(t.window)} samples over {t.window[-1].t_min:g} min &nbsp; "
                f"<b>Raw CSV:</b> {t.raw_csv}", small,
            ),
            Paragraph(
                "<b>Evidence:</b> " + (", ".join(t.evidence) if t.evidence else "—"), small,
            ),
        ]
        flow.append(KeepTogether(block))

    # (5) Sign-off ----------------------------------------------------------
    flow.append(Paragraph("Sign-off", h2))
    sign = Table([
        ["Operator", run.operator or "________________", "Date", "____________"],
        ["Reviewer", run.reviewer or "________________", "Date", "____________"],
    ], colWidths=[24 * mm, 70 * mm, 16 * mm, 40 * mm])
    sign.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("LINEBELOW", (1, 0), (1, -1), 0.5, colors.HexColor("#94a3b8")),
        ("LINEBELOW", (3, 0), (3, -1), 0.5, colors.HexColor("#94a3b8")),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
    ]))
    flow.append(sign)

    footer = f"{run.module_id}  ·  {run.run_id}  ·  git {meta['git_sha']}"
    doc.build(flow, canvasmaker=_numbered_canvas(footer))
    return buf.getvalue()
