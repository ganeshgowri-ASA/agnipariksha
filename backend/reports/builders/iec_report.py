"""ReportLab-based IEC report builder for Tab-5.

Produces a multi-page PDF with the structure operators (and Reliance)
expect:

  Cover         - title + IEC clause + module SN + customer/operator block
  Section 1     - Test parameters (setpoints from the session)
  Section 2     - Result summary (PASS/FAIL, KPIs, IEC verdict text)
  Section 3     - Time-series chart (rendered by matplotlib to PNG)
  Section 4     - Raw data appendix metadata (CSV path + row count + SHA256)

The function is intentionally pure (no DB lookups, no SCPI calls): it
takes a fully-resolved session payload + an optional path to the raw
CSV and returns the PDF as bytes. Callers (the FastAPI route, batch
re-render scripts, CI smoke tests) construct the payload however they
want.

If matplotlib or ReportLab is unavailable (e.g. trimmed runtime image),
the builder falls back to a text-only minimal PDF so the endpoint
always returns a valid file. The fallback prints a banner so the
operator knows charts are missing.
"""
from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# These imports are guarded so the module imports even if the optional
# rendering deps are missing in a slim runtime image. The route returns
# a degraded-but-valid PDF in that case.
try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
        PageBreak, Image,
    )
    _HAS_REPORTLAB = True
except ImportError:  # pragma: no cover - guarded by tests skipping on miss
    _HAS_REPORTLAB = False

try:
    import matplotlib

    matplotlib.use("Agg")  # headless render — no DISPLAY in CI / container
    import matplotlib.pyplot as plt
    _HAS_MATPLOTLIB = True
except ImportError:  # pragma: no cover
    _HAS_MATPLOTLIB = False


# Module-level constant — referenced from f-strings where Python 3.11 forbids
# inline ``'\u2014'`` escapes in f-string expressions.
EM_DASH = "\u2014"


@dataclass
class ReportContext:
    """Normalised session payload the builder works against.

    The frontend POSTs a TestSession-shaped JSON, but the same builder
    is reused by batch CLI scripts that pass dataclass instances. This
    dataclass is the canonical shape.
    """

    session_id: str
    test_type: str
    iec_clause: str
    standard: str
    start_time_ms: int
    end_time_ms: Optional[int]
    status: str
    result: str
    operator_name: str
    operator_id: str
    company_name: str
    customer_name: str
    equipment_id: str
    method_reference: str
    module_serial: str
    notes: str
    readings: list[dict[str, Any]] = field(default_factory=list)
    setpoints: dict[str, Any] = field(default_factory=dict)
    kpis: dict[str, Any] = field(default_factory=dict)
    csv_path: Optional[str] = None
    # ISO/IEC 17025 §7.8 declarations (optional payload extras; defaults keep
    # existing callers working while flagging what the lab must fill in).
    env_conditions: str = "not recorded"
    uncertainty: str = (
        "Measurement uncertainty per the station calibration records; "
        "stated on request where relevant to conformity."
    )
    deviations: str = "none"
    approved_by: str = ""
    approver_role: str = ""

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "ReportContext":
        """Liberally accept the frontend TestSession shape + extras."""
        # Map a handful of common standards to their human-readable form
        std_for = {
            "thermal_cycling": "IEC 61215-2 — Thermal Cycling",
            "humidity_freeze": "IEC 61215-2 — Humidity Freeze",
            "pid":             "IEC TS 62804-1 — PID",
            "letid":           "IEC TS 63342:2022 — LeTID",
            "bdt":             "IEC 62979:2017 — Bypass Diode Thermal",
            "rco":             "IEC 61730-2:2023 MST 26 — Reverse Current Overload",
            "gct":             "IEC 61730-2:2023 MST 13 — Ground Continuity",
            "eb":              "IEC 61730-2:2023 MST 11 — Equipotential Bonding",
            "ir":              "IEC TS 60904-12 — Forward-Bias IR",
        }
        tt = str(payload.get("testType", "")).lower()
        return cls(
            session_id=str(payload.get("id", "—")),
            test_type=tt,
            iec_clause=str(payload.get("iecClause", "")),
            standard=str(payload.get("standard") or std_for.get(tt, "IEC PV reliability")),
            start_time_ms=int(payload.get("startTime", 0)),
            end_time_ms=payload.get("endTime"),
            status=str(payload.get("status", "")),
            result=str(payload.get("result") or payload.get("status", "")).upper(),
            operator_name=str(payload.get("operatorName") or "Anonymous"),
            operator_id=str(payload.get("operatorId") or "N/A"),
            company_name=str(payload.get("companyName") or "N/A"),
            customer_name=str(payload.get("customerName") or "N/A"),
            equipment_id=str(payload.get("equipmentId") or "N/A"),
            method_reference=str(payload.get("methodReference") or "IEC 61215/61730 series"),
            module_serial=str(payload.get("moduleSerial") or payload.get("moduleId") or "N/A"),
            notes=str(payload.get("notes") or ""),
            readings=list(payload.get("readings", [])),
            setpoints=dict(payload.get("setpoints", {})),
            kpis=dict(payload.get("kpis", {})),
            csv_path=payload.get("csvPath") or payload.get("rawDataPath"),
            env_conditions=str(payload.get("envConditions") or "not recorded"),
            uncertainty=str(payload.get("uncertainty") or cls.uncertainty),
            deviations=str(payload.get("deviations") or "none"),
            approved_by=str(payload.get("approvedBy") or ""),
            approver_role=str(payload.get("approverRole") or ""),
        )


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def build_iec_report(payload: dict[str, Any]) -> bytes:
    """Build a PDF from a session payload. Returns PDF bytes.

    The payload is the same shape the frontend ``TestSession`` object
    serializes to, with the optional metadata fields populated by
    :func:`stampOperatorContext` on the frontend.
    """
    ctx = ReportContext.from_payload(payload)

    if not _HAS_REPORTLAB:
        return _build_text_fallback(ctx)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=15 * mm, rightMargin=15 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm,
        title=f"{ctx.standard} — {ctx.session_id}",
        author=ctx.company_name or "Agnipariksha",
    )
    story: list[Any] = []
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Heading1"], fontSize=16, spaceAfter=8, textColor=colors.HexColor("#0f172a"))
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=12, spaceAfter=4, textColor=colors.HexColor("#1e293b"))
    body = styles["BodyText"]
    small = ParagraphStyle("small", parent=body, fontSize=8, textColor=colors.HexColor("#475569"))

    # --- Cover ---
    story.append(Paragraph(f"<b>{ctx.standard}</b>", h1))
    story.append(Paragraph(
        f"Test report for session <b>{ctx.session_id}</b> · "
        f"clause <b>{ctx.iec_clause or '—'}</b>", body,
    ))
    story.append(Spacer(1, 8))

    cover_rows = [
        ["Operator",         f"{ctx.operator_name} ({ctx.operator_id})"],
        ["Company / Lab",    ctx.company_name],
        ["Customer",         ctx.customer_name],
        ["Equipment",        ctx.equipment_id],
        ["Method reference", ctx.method_reference],
        ["Module SN",        ctx.module_serial],
        ["Test started",     _fmt_ms(ctx.start_time_ms)],
        ["Test ended",       _fmt_ms(ctx.end_time_ms) if ctx.end_time_ms else "in progress"],
        ["Result",           ctx.result or "—"],
    ]
    cover_table = Table(cover_rows, colWidths=[45 * mm, 120 * mm])
    cover_table.setStyle(_table_style())
    story.append(cover_table)

    # --- Section 1: setpoints ---
    story.append(Spacer(1, 14))
    story.append(Paragraph("1. Test parameters", h2))
    sp_rows: list[list[str]] = (
        [[k, str(v)] for k, v in ctx.setpoints.items()] if ctx.setpoints
        else [["—", "no setpoints captured in this session"]]
    )
    sp_table = Table([["Parameter", "Value"]] + sp_rows, colWidths=[60 * mm, 105 * mm])
    sp_table.setStyle(_table_style(header=True))
    story.append(sp_table)

    # --- Section 2: result + KPIs ---
    story.append(Spacer(1, 14))
    story.append(Paragraph("2. Result summary", h2))
    if ctx.kpis:
        kpi_rows = [[k, str(v)] for k, v in ctx.kpis.items()]
    else:
        kpi_rows = [[
            "Total readings",
            str(len(ctx.readings)),
        ], [
            "Duration",
            _fmt_duration(ctx.start_time_ms, ctx.end_time_ms),
        ]]
    kpi_table = Table([["KPI", "Value"]] + kpi_rows, colWidths=[60 * mm, 105 * mm])
    kpi_table.setStyle(_table_style(header=True))
    story.append(kpi_table)

    verdict_text = _verdict_paragraph(ctx)
    if verdict_text:
        story.append(Spacer(1, 8))
        story.append(Paragraph(verdict_text, body))

    # --- Section 3: time-series chart ---
    story.append(Spacer(1, 14))
    story.append(Paragraph("3. Time-series", h2))
    chart_png = _render_timeseries_chart(ctx) if _HAS_MATPLOTLIB else None
    if chart_png is not None:
        story.append(Image(io.BytesIO(chart_png), width=170 * mm, height=80 * mm))
    else:
        story.append(Paragraph(
            "Chart unavailable (matplotlib not installed in this runtime). "
            "Raw data appendix \u00a74 contains the underlying readings.", small,
        ))

    # --- Section 4: appendix ---
    story.append(PageBreak())
    story.append(Paragraph("4. Raw data appendix", h2))
    notes_str = ctx.notes or EM_DASH
    csv_str = ctx.csv_path or "not persisted"
    story.append(Paragraph(
        f"Total readings: <b>{len(ctx.readings)}</b><br/>"
        f"Notes: {notes_str}<br/>"
        f"Raw CSV: {csv_str}", body,
    ))
    if ctx.csv_path:
        try:
            data = Path(ctx.csv_path).read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            story.append(Paragraph(f"CSV SHA-256: <font face='Courier'>{digest}</font>", small))
        except OSError:
            story.append(Paragraph("CSV file not readable at report time.", small))

    # --- Section 5: ISO/IEC 17025 §7.8 declarations ---
    story.append(Spacer(1, 14))
    story.append(Paragraph("5. ISO/IEC 17025 declarations", h2))
    approver = (
        f"{ctx.approved_by} ({ctx.approver_role})"
        if ctx.approved_by
        else "________________________  (name, function, signature)"
    )
    iso_rows = [
        ["Method (incl. edition)",    ctx.standard],
        ["Environmental conditions",  ctx.env_conditions],
        ["Measurement uncertainty",   ctx.uncertainty],
        ["Deviations from method",    ctx.deviations],
        ["Report issue date (UTC)",   datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")],
        ["Authorised by",             approver],
    ]
    iso_table = Table(iso_rows, colWidths=[45 * mm, 120 * mm])
    iso_table.setStyle(_table_style())
    story.append(iso_table)
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "The results reported herein relate only to the item(s) tested. "
        "This report shall not be reproduced except in full without the "
        "written approval of the laboratory.", small,
    ))

    story.append(Spacer(1, 12))
    story.append(Paragraph(
        f"Generated by Agnipariksha on {datetime.now(timezone.utc).isoformat()}", small,
    ))

    doc.build(story)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fmt_ms(ms: Optional[int]) -> str:
    if not ms:
        return "—"
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def _fmt_duration(start_ms: int, end_ms: Optional[int]) -> str:
    if not start_ms or not end_ms:
        return "—"
    s = (end_ms - start_ms) / 1000
    if s < 60:
        return f"{s:.1f} s"
    if s < 3600:
        return f"{s/60:.1f} min"
    return f"{s/3600:.1f} h"


def _table_style(*, header: bool = False) -> Any:
    cmds = [
        ("FONTNAME",   (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE",   (0, 0), (-1, -1), 9),
        ("GRID",       (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")),
        ("VALIGN",     (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING",(0, 0), (-1, -1), 6),
        ("RIGHTPADDING",(0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 4),
    ]
    if header:
        cmds += [
            ("BACKGROUND",(0, 0), (-1, 0), colors.HexColor("#e2e8f0")),
            ("FONTNAME",  (0, 0), (-1, 0), "Helvetica-Bold"),
        ]
    return TableStyle(cmds)


def _verdict_paragraph(ctx: ReportContext) -> str:
    """Render the IEC-specific verdict text for the test type."""
    tt = ctx.test_type
    if tt == "thermal_cycling":
        return (
            f"Per IEC 61215-2 MQT 11 the module passes when {ctx.kpis.get('cyclesTarget', 200)} "
            "thermal cycles complete with ramp \u2264100 \u00b0C/h and Isc applied only when "
            "T_module &gt; 25 \u00b0C. Verdict: <b>" + (ctx.result or "—") + "</b>."
        )
    if tt == "humidity_freeze":
        return (
            "Per IEC 61215-2 MQT 12 the module passes when 10 hot-humid/freeze cycles "
            "complete with hot dwell \u226520 h, cold dwell \u226530 min, RH 85\u00b15 %. "
            f"Verdict: <b>{ctx.result or '—'}</b>."
        )
    if tt == "gct" or tt == "ground_continuity":
        return (
            "Per IEC 61730-2 MST 13 every grounding path must measure \u22640.1 \u03a9. "
            f"Verdict: <b>{ctx.result or '—'}</b>."
        )
    return ""


def _render_timeseries_chart(ctx: ReportContext) -> Optional[bytes]:
    if not _HAS_MATPLOTLIB or not ctx.readings:
        return None
    try:
        t0 = ctx.readings[0].get("timestamp", 0)
        xs = [(r.get("timestamp", 0) - t0) / 60000 for r in ctx.readings]
        v = [r.get("voltage") for r in ctx.readings]
        i = [r.get("current") for r in ctx.readings]
        T = [r.get("temperature") for r in ctx.readings]

        fig, ax1 = plt.subplots(figsize=(8, 3.5))
        ax2 = ax1.twinx()
        ax1.plot(xs, v, color="#2563eb", linewidth=1, label="V")
        ax1.plot(xs, i, color="#dc2626", linewidth=1, label="I")
        ax1.set_xlabel("Time (min)")
        ax1.set_ylabel("V / I")
        if any(t is not None for t in T):
            ax2.plot(xs, T, color="#f59e0b", linewidth=1, linestyle="--", label="T")
            ax2.set_ylabel("T (\u00b0C)")
        ax1.grid(True, alpha=0.3)
        ax1.set_title(f"{ctx.standard} \u2014 session {ctx.session_id}", fontsize=9)
        fig.tight_layout()
        out = io.BytesIO()
        fig.savefig(out, format="png", dpi=144)
        plt.close(fig)
        return out.getvalue()
    except Exception:  # pragma: no cover - chart is best-effort
        return None


def _build_text_fallback(ctx: ReportContext) -> bytes:
    """Tiny hand-rolled PDF used when ReportLab is missing.

    Single page, Helvetica, lists the key cover fields. Same byte format
    as the legacy frontend route so existing CI smoke tests continue to
    accept the response.
    """
    def esc(s: str) -> str:
        return s.replace("\\", "\\\\").replace("(", r"\(").replace(")", r"\)")

    lines = [
        f"{ctx.standard} - {ctx.session_id}",
        f"Operator: {ctx.operator_name} ({ctx.operator_id})",
        f"Company:  {ctx.company_name}",
        f"Customer: {ctx.customer_name}",
        f"Module:   {ctx.module_serial}",
        f"Result:   {ctx.result or '-'}",
        f"Readings: {len(ctx.readings)}",
        "(degraded report - ReportLab not available)",
    ]
    header = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
    content_parts = ["BT", "/F1 12 Tf"]
    y = 740
    for line in lines:
        content_parts.append(f"1 0 0 1 60 {y} Tm")
        content_parts.append(f"({esc(line)}) Tj")
        y -= 18
    content_parts.append("ET")
    content = ("\n".join(content_parts) + "\n").encode("latin1")
    obj1 = b"1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n"
    obj2 = b"2 0 obj\n<</Type /Pages /Kids [3 0 R] /Count 1>>\nendobj\n"
    obj4 = (
        f"4 0 obj\n<</Length {len(content)}>>\nstream\n".encode("latin1")
        + content + b"endstream\nendobj\n"
    )
    obj3 = (
        b"3 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>>\nendobj\n"
    )
    obj5 = b"5 0 obj\n<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>\nendobj\n"
    cursor = len(header)
    off = []
    for o in (obj1, obj2, obj3, obj4, obj5):
        off.append(cursor)
        cursor += len(o)
    xref_offset = cursor

    def pad(n: int) -> bytes:
        return f"{n:010d}".encode("latin1")

    xref = b"xref\n0 6\n0000000000 65535 f \n"
    for o in off:
        xref += pad(o) + b" 00000 n \n"
    trailer = b"trailer\n<</Size 6 /Root 1 0 R>>\n"
    return header + obj1 + obj2 + obj3 + obj4 + obj5 + xref + trailer + f"startxref\n{xref_offset}\n%%EOF\n".encode("latin1")
