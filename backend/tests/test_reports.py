"""Tests for the Tab 5 IEC report endpoints + extended per-test sections.

Pins:
  * the basic contract (list / HTML twin / PDF magic / 404 / verdict mapping)
  * each new section chart helper produces a valid PNG
  * each new section's HTML carries its IEC clause anchor + key real data
  * the non-conformance computations (TC, PID, GCT) do what the spec says
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.reports import get_run, list_runs, reports_router  # noqa: E402
from backend.app.reports import charts, sections  # noqa: E402

RUN_ID = "DEMO-RUN-001"


@pytest.fixture(scope="module")
def client() -> TestClient:
    app = FastAPI()
    app.include_router(reports_router)
    return TestClient(app)


@pytest.fixture(scope="module")
def run():
    r = get_run(RUN_ID)
    assert r is not None
    return r


@pytest.fixture(scope="module")
def html(client: TestClient) -> str:
    r = client.get(f"/api/reports/{RUN_ID}.html")
    assert r.status_code == 200
    return r.text


# ---------------------------------------------------------------------------
# Core contract
# ---------------------------------------------------------------------------

def test_list_reports_exposes_demo_run(client: TestClient) -> None:
    body = client.get("/api/reports").json()
    assert any(r["run_id"] == RUN_ID for r in body)


def test_overall_is_fail_when_any_test_fails(run) -> None:
    verdicts = {t.verdict for t in run.tests}
    assert "FAIL" in verdicts          # humidity-freeze drops ~6.2%
    assert "INCONCLUSIVE" in verdicts  # bypass-diode has no temperature data
    assert run.overall == "FAIL"


def test_html_twin_carries_core_sections(client: TestClient, html: str, run) -> None:
    for token in (run.module_id, run.run_id, run.test_id, "IST", "DEMO REPORT", "Sign-off"):
        assert token in html
    for t in run.tests:
        assert t.name in html
    assert "INCONCLUSIVE" in html


def test_pdf_twin_is_valid_pdf(client: TestClient) -> None:
    r = client.get(f"/api/reports/{RUN_ID}.pdf")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content[:5] == b"%PDF-"
    assert len(r.content) > 5000


def test_unknown_run_id_404(client: TestClient) -> None:
    assert client.get("/api/reports/NOPE.html").status_code == 404
    assert client.get("/api/reports/NOPE.pdf").status_code == 404


# ---------------------------------------------------------------------------
# IEC clause anchors — every extended section must cite its clause
# ---------------------------------------------------------------------------

def test_extended_sections_anchor_to_iec_clauses(html: str) -> None:
    for clause in (
        "IEC 61215-2 MQT 11",   # TC
        "IEC 61215-2 MQT 12",   # HF
        "IEC TS 62804-1",        # PID
        "IEC TS 63342:2022",     # LeTID
        "IEC 61730 MST 26",      # RCO
        "IEC 61730-2 MST 13",    # GCT
        "IEC TS 60904-13",       # EL
    ):
        assert clause in html, f"missing clause anchor: {clause}"


# ---------------------------------------------------------------------------
# 1. Thermal Cycling — 2 charts + non-conformance computation
# ---------------------------------------------------------------------------

def test_tc_time_series_chart_png(run) -> None:
    png = charts.tc_time_series_png(run.tc)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_tc_ramp_panel_chart_png(run) -> None:
    png = charts.tc_ramp_panel_png(run.tc)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_tc_html_carries_jbox_and_position(html: str) -> None:
    assert "J-box mass loading" in html
    assert "Bifacial" in html


def test_tc_nonconform_flags_ramp_spike(run) -> None:
    # The triangle wave's ramp-to-dwell transition exceeds the tolerance band,
    # so the section MUST report a NON-CONFORM entry per IEC 61215-2 MQT 11.
    flags = run.tc.nonconform
    assert flags, "expected at least one NON-CONFORM flag"
    assert any("ramp" in f for f in flags)


def test_tc_actual_ramp_pt_matches_diff(run) -> None:
    pt = run.tc.actual_ramp_pt
    s = run.tc.samples
    # First point-to-point ramp == (T1 - T0) / (t1 - t0).
    assert pt[0][0] == s[1].t_min
    assert pt[0][1] == pytest.approx((s[1].mod_t_c - s[0].mod_t_c) / (s[1].t_min - s[0].t_min))


# ---------------------------------------------------------------------------
# 2. Humidity Freeze — 2 charts + tolerance/uniformity metadata
# ---------------------------------------------------------------------------

def test_hf_combined_chart_png(run) -> None:
    png = charts.hf_combined_png(run.hf)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_hf_ramp_panel_chart_png(run) -> None:
    png = charts.hf_ramp_panel_png(run.hf)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_hf_ramp_modes_supported() -> None:
    # Spec: dual ramp modes 100 °C/h and 200 °C/h selectable.
    a = sections.gen_hf(ramp_mode_c_per_h=100)
    b = sections.gen_hf(ramp_mode_c_per_h=200)
    assert a.ramp_mode_c_per_h == 100 and b.ramp_mode_c_per_h == 200
    assert b.set_ramp_c_per_min == pytest.approx(2 * a.set_ramp_c_per_min)


def test_hf_html_shows_uniformity_metric(html: str) -> None:
    assert "Chamber uniformity" in html
    assert "Ramp mode" in html


# ---------------------------------------------------------------------------
# 3. PID — chart + post-stabilization non-conformance
# ---------------------------------------------------------------------------

def test_pid_chart_png(run) -> None:
    png = charts.pid_chart_png(run.pid)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_pid_html_states_post_stab_tightening(html: str) -> None:
    assert "Stabilization at" in html
    assert "Post-stab" in html or "post-stab" in html.lower()


def test_pid_nonconform_uses_tighter_post_stab_tolerance() -> None:
    # Force a post-stabilization T deviation above the tight tolerance:
    base = sections.gen_pid(stabilization_h=0.0)
    bad_samples = [
        sections.PIDSample(t_min=p.t_min,
                           chamber_t_c=p.chamber_t_c + 1.5,   # > 1.0 °C tight tol
                           rh_pct=p.rh_pct, leakage_a=p.leakage_a)
        for p in base.samples
    ]
    s = sections.PIDSection(
        clause=base.clause, samples=bad_samples,
        stabilization_h=0.0,
        t_tolerance_c=2.0, rh_tolerance_pct=5.0,
        leakage_threshold_a=10e-6,
        post_stab_t_tolerance_c=1.0, post_stab_rh_tolerance_pct=2.0,
        setpoint_t_c=85.0, setpoint_rh_pct=85.0,
    )
    flags = s.nonconform
    assert flags and any("T=" in f for f in flags)


# ---------------------------------------------------------------------------
# 4. LeTID — chart + uncertainty table
# ---------------------------------------------------------------------------

def test_letid_extended_chart_png(run) -> None:
    png = charts.letid_chart_png(run.letid)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_letid_html_carries_uncertainty_table(html: str) -> None:
    assert "Uncertainty" in html
    assert "Dark V_oc" in html
    assert "Stop criteria" in html


# ---------------------------------------------------------------------------
# 6. RCO — chart + thermocouple peaks table + thermal-image ref
# ---------------------------------------------------------------------------

def test_rco_temp_trace_chart_png(run) -> None:
    png = charts.rco_temp_trace_png(run.rco)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_rco_html_no_bus_label(html: str) -> None:
    # Spec: "Remove the 'bus' label — we are NOT measuring bus."
    rco_idx = html.find("RCO — extended analysis")
    assert rco_idx >= 0
    next_section = html.find('class="section"', rco_idx + 1)
    rco_html = html[rco_idx:next_section if next_section > 0 else len(html)]
    assert " bus " not in rco_html.lower()


def test_rco_html_carries_test_current_thermal_and_tcs(html: str) -> None:
    assert "1.35×Isc" in html
    assert "Thermal image" in html or "Thermocouple" in html
    assert "TC1" in html  # one of the thermocouple labels


# ---------------------------------------------------------------------------
# 7. GCT — chart + shortest/longest path verdicts
# ---------------------------------------------------------------------------

def test_gct_extended_chart_png(run) -> None:
    png = charts.gct_chart_png(run.gct)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_gct_html_renders_both_paths(html: str, run) -> None:
    assert run.gct.shortest.label in html
    assert run.gct.longest.label in html


def test_gct_path_verdicts_pin_to_max_resistance(run) -> None:
    assert run.gct.shortest.resistance_ohm <= run.gct.max_resistance_ohm
    assert run.gct.longest.resistance_ohm <= run.gct.max_resistance_ohm


# ---------------------------------------------------------------------------
# 8. EL — defect index, defect criteria, MBJ, metadata
# ---------------------------------------------------------------------------

def test_el_html_states_defect_index_and_threshold(html: str, run) -> None:
    assert "Defect index" in html
    assert f"{run.el.defect_index_threshold:.3f}" in html


def test_el_html_lists_iec_60904_13_criteria(html: str) -> None:
    assert "IEC 60904-13" in html
    assert "IEA PVPS" in html


def test_el_html_shows_mbj_state(html: str) -> None:
    assert "MBJ" in html
    assert "Multi-Busbar" in html or "Multi-busbar" in html.lower()


def test_el_metadata_present_in_html(html: str, run) -> None:
    assert run.el.camera in html
    assert run.el.psu_setting in html


# ---------------------------------------------------------------------------
# 9. IIR — heatmap chart + metadata
# ---------------------------------------------------------------------------

def test_iir_heatmap_chart_png(run) -> None:
    png = charts.iir_heatmap_png(run.iir)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_iir_html_states_camera_and_psu(html: str, run) -> None:
    assert "Inverted IR Thermography" in html
    assert run.iir.camera in html
    assert run.iir.psu_setting in html


def test_iir_grid_dimensions_match(run) -> None:
    grid = run.iir.grid_t_c
    assert grid and all(len(row) == len(grid[0]) for row in grid)


# ---------------------------------------------------------------------------
# 10. Power Generation — two charts + sample table
# ---------------------------------------------------------------------------

def test_powergen_iv_chart_png(run) -> None:
    png = charts.powergen_iv_png(run.powergen)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_powergen_env_chart_png(run) -> None:
    png = charts.powergen_env_png(run.powergen)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_powergen_html_lists_sample_table(html: str) -> None:
    assert "Pmax · Voc · Isc · FF · Vmp · Imp" in html
    assert "Environmental conditions" in html
    # The table header row tokens.
    for h in ("Pmax (W)", "Voc (V)", "Isc (A)", "FF", "Vmp (V)", "Imp (A)"):
        assert h in html


def test_powergen_pmax_peaks_at_max_irradiance(run) -> None:
    s = run.powergen
    i_peak = max(range(len(s.env)), key=lambda i: s.env[i].irradiance_w_m2)
    # Pmax peak should occur within a couple of samples of the irradiance peak.
    p_peak = max(range(len(s.samples)), key=lambda i: s.samples[i].pmax_w)
    assert abs(i_peak - p_peak) <= 2
