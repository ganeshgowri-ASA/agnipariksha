"""PDF report generator for the Ground Continuity (MST 13) test.

Renders a single-page summary with:
- Header (module id, session, standard, date, overall verdict)
- Probe map (placeholder module diagram with the configured probe points)
- Per-probe resistance table with pass/fail highlight
- Raw CSV artifact paths
- IEC 61730-2 reference footer

Falls back to a plain-text ``.txt`` report if reportlab isn't installed,
so the orchestrator never blocks on optional deps.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .ground_continuity import (
    GroundContinuityConfig,
    GroundContinuityResult,
    STANDARD_REF,
)


def _format_summary_lines(
    result: GroundContinuityResult,
    config: GroundContinuityConfig,
) -> list[str]:
    when = datetime.fromtimestamp(result.started_ts, tz=timezone.utc).isoformat(timespec="seconds")
    lines = [
        "AGNIPARIKSHA — Ground Continuity Report",
        "=" * 50,
        f"Standard:       {result.standard}",
        f"Module ID:      {result.module_id}",
        f"Session ID:     {result.session_id}",
        f"Started (UTC):  {when}",
        f"Test current:   {result.test_current_a:.2f} A "
        f"(rated I = {config.rated_module_current_a:.2f} A; "
        f"max(2.5*I, 25 A))",
        f"Pass limit:     R <= {result.pass_resistance_ohm:.3f} ohm per probe",
        f"OVERALL:        {'PASS' if result.overall_pass else 'FAIL'}",
        "",
        "Per-probe results",
        "-" * 50,
        f"{'ID':<5} {'Label':<14} {'R (ohm)':>10} {'Stab %':>8} {'Verdict':>8}",
    ]
    for p in result.probes:
        lines.append(
            f"{p.probe_id:<5} {p.label:<14} {p.resistance_ohm:>10.6f} "
            f"{p.contact_stability_pct:>8.2f} {'PASS' if p.passed else 'FAIL':>8}"
        )
    lines += [
        "",
        "Raw traces (CSV)",
        "-" * 50,
    ]
    for p in result.probes:
        lines.append(f"  {p.probe_id}: {p.csv_path or '(not written)'}")
    lines += [
        "",
        f"Reference: {STANDARD_REF}",
        "Probe map: see PDF page 1 (placeholder module diagram).",
    ]
    return lines


def _write_text_report(path: Path, lines: list[str]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def _try_render_pdf(
    path: Path,
    result: GroundContinuityResult,
    config: GroundContinuityConfig,
) -> Optional[Path]:
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import LETTER
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.units import inch
        from reportlab.pdfgen import canvas
        from reportlab.platypus import Table, TableStyle
    except Exception:
        return None

    path.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(path), pagesize=LETTER)
    width, height = LETTER

    # ---- Header --------------------------------------------------------
    c.setFont("Helvetica-Bold", 16)
    c.drawString(0.6 * inch, height - 0.7 * inch,
                 "Ground Continuity Test — IEC 61730-2 MST 13")
    c.setFont("Helvetica", 10)
    when = datetime.fromtimestamp(result.started_ts, tz=timezone.utc).isoformat(timespec="seconds")
    c.drawString(0.6 * inch, height - 0.95 * inch,
                 f"Module: {result.module_id}    Session: {result.session_id}    "
                 f"Started (UTC): {when}")
    c.drawString(0.6 * inch, height - 1.13 * inch,
                 f"Test current: {result.test_current_a:.2f} A   "
                 f"Pass limit: R <= {result.pass_resistance_ohm:.3f} ohm per probe")

    verdict = "PASS" if result.overall_pass else "FAIL"
    verdict_color = colors.green if result.overall_pass else colors.red
    c.setFillColor(verdict_color)
    c.setFont("Helvetica-Bold", 14)
    c.drawRightString(width - 0.6 * inch, height - 0.7 * inch, f"OVERALL: {verdict}")
    c.setFillColor(colors.black)

    # ---- Probe map placeholder ----------------------------------------
    map_top = height - 1.4 * inch
    map_left = 0.6 * inch
    map_w = 3.4 * inch
    map_h = 2.5 * inch
    c.setStrokeColor(colors.grey)
    c.setLineWidth(0.8)
    c.rect(map_left, map_top - map_h, map_w, map_h, stroke=1, fill=0)
    c.setFont("Helvetica-Oblique", 9)
    c.setFillColor(colors.grey)
    c.drawString(map_left + 6, map_top - 14, "Probe map (placeholder module diagram)")
    c.setFillColor(colors.black)

    # Plot probe points on the diagram. Probe (x,y) is normalised 0..1
    # with origin at the top-left of the module.
    for p in result.probes:
        # Find matching ProbePoint to get coordinates.
        pt = next((pp for pp in config.probe_points if pp.id == p.probe_id), None)
        if pt is None:
            continue
        cx = map_left + pt.x * map_w
        cy = (map_top - map_h) + (1.0 - pt.y) * map_h
        c.setFillColor(colors.green if p.passed else colors.red)
        c.circle(cx, cy, 5, stroke=0, fill=1)
        c.setFillColor(colors.black)
        c.setFont("Helvetica", 7)
        c.drawString(cx + 7, cy - 3, f"{p.probe_id}: {p.resistance_ohm:.4f}Ω")

    # ---- Per-probe table ----------------------------------------------
    table_data = [["ID", "Label", "I (A)", "V mean (V)",
                   "R (ohm)", "R min", "R max", "Stab %", "Verdict"]]
    row_styles = []
    for idx, p in enumerate(result.probes, start=1):
        table_data.append([
            p.probe_id,
            p.label,
            f"{p.mean_current_a:.3f}",
            f"{p.mean_voltage_v:.4f}",
            f"{p.resistance_ohm:.6f}",
            f"{p.resistance_min_ohm:.6f}",
            f"{p.resistance_max_ohm:.6f}",
            f"{p.contact_stability_pct:.2f}",
            "PASS" if p.passed else "FAIL",
        ])
        bg = colors.HexColor("#dcfce7") if p.passed else colors.HexColor("#fee2e2")
        row_styles.append(("BACKGROUND", (0, idx), (-1, idx), bg))
        row_styles.append((
            "TEXTCOLOR", (-1, idx), (-1, idx),
            colors.darkgreen if p.passed else colors.darkred,
        ))

    table = Table(table_data, hAlign="LEFT", colWidths=[
        0.45 * inch, 0.95 * inch, 0.55 * inch, 0.7 * inch,
        0.7 * inch, 0.6 * inch, 0.6 * inch, 0.55 * inch, 0.6 * inch,
    ])
    style = TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f2937")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
        *row_styles,
    ])
    table.setStyle(style)
    table_w, table_h = table.wrap(width - 1.2 * inch, 4 * inch)
    table_x = map_left + map_w + 0.25 * inch
    table_y = map_top - table_h
    if table_x + table_w > width - 0.4 * inch:
        # Fall back to placing the table below the probe map if it would
        # overflow horizontally.
        table_x = 0.6 * inch
        table_y = (map_top - map_h) - 0.25 * inch - table_h
    table.drawOn(c, table_x, table_y)

    # ---- Raw CSV paths -------------------------------------------------
    y = min(table_y, map_top - map_h) - 0.35 * inch
    c.setFont("Helvetica-Bold", 10)
    c.drawString(0.6 * inch, y, "Raw traces (CSV)")
    y -= 14
    c.setFont("Helvetica", 8)
    for p in result.probes:
        c.drawString(0.6 * inch, y, f"{p.probe_id}  {p.label}: {p.csv_path or '(not written)'}")
        y -= 11

    # ---- Footer / standard reference ----------------------------------
    c.setFont("Helvetica-Oblique", 8)
    c.setFillColor(colors.grey)
    c.drawString(0.6 * inch, 0.5 * inch, f"Reference: {STANDARD_REF}")
    c.drawRightString(width - 0.6 * inch, 0.5 * inch,
                      "Generated by Agnipariksha")
    c.showPage()
    c.save()
    return path


def render_report(
    result: GroundContinuityResult,
    config: GroundContinuityConfig,
    *,
    out_dir: Optional[Path] = None,
) -> Path:
    """Write a PDF report (preferred) or text fallback. Returns the path."""
    base = Path(out_dir) if out_dir else Path(result.artifact_dir)
    base.mkdir(parents=True, exist_ok=True)
    pdf_path = base / "report.pdf"
    rendered = _try_render_pdf(pdf_path, result, config)
    if rendered is not None:
        return rendered
    txt_path = base / "report.txt"
    return _write_text_report(txt_path, _format_summary_lines(result, config))


__all__ = ["render_report"]
