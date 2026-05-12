"""Report Engine v2 — section registry + size-delta assertions.

Mirrors the Playwright spec (toggle 3 sections off, assert a size delta)
on the server side so CI can exercise the section logic without spinning
up a browser.
"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.main import app  # noqa: E402
from backend.reports import ALL_SECTIONS, build_docx, build_pdf  # noqa: E402
from backend.reports.registry import Reading, ReportRequest  # noqa: E402


def _sample_request(**overrides) -> ReportRequest:
    readings = [
        Reading(
            timestamp=float(i),
            voltage=40.0 - i * 0.01,
            current=8.0,
            power=320.0 - i * 0.05,
            temperature=25.0 + i * 0.02,
            rh=50.0,
            tj=30.0,
            vf=0.6 + i * 0.001,
        )
        for i in range(60)
    ]
    base = dict(
        run_id="r-test",
        test_name="Thermal Cycling",
        standard="IEC 61215-2",
        iec_clause="MQT 11",
        operator="alice",
        module_id="MOD-1",
        lab_name="ASA PV Lab",
        result="PASS",
        pre_max_power=320.0,
        post_max_power=317.0,
        delta_pmax_percent=-0.94,
        threshold_percent=-5.0,
        readings=readings,
        error_log=["sensor jitter @ t=5"],
        troubleshooting=["check thermocouple seating"],
    )
    base.update(overrides)
    return ReportRequest(**base)


def test_sections_registry_complete() -> None:
    assert set(ALL_SECTIONS) >= {
        "header", "test_description", "iec_clause", "parameters",
        "graphs", "tables", "pass_fail", "raw_data_path",
        "error_log", "troubleshooting", "signature", "photos",
    }


def test_pdf_size_delta_when_three_sections_off() -> None:
    full = build_pdf(_sample_request())
    trimmed = build_pdf(_sample_request(
        sections=[s for s in ALL_SECTIONS if s not in {"graphs", "tables", "photos"}],
    ))
    assert len(full) > 0
    assert len(trimmed) > 0
    # Dropping the three heaviest sections must visibly shrink the PDF.
    assert len(full) - len(trimmed) > 1000, (
        f"expected significant size delta, got full={len(full)} trimmed={len(trimmed)}"
    )


def test_docx_size_delta_when_three_sections_off() -> None:
    full = build_docx(_sample_request())
    trimmed = build_docx(_sample_request(
        sections=[s for s in ALL_SECTIONS if s not in {"graphs", "tables", "photos"}],
    ))
    assert len(full) - len(trimmed) > 1000


def test_pdf_endpoint_v2_shape() -> None:
    with TestClient(app) as c:
        r = c.post("/api/reports/generate", json={
            "run_id": "abc",
            "test_name": "Humidity Freeze",
            "standard": "IEC 61215-2",
            "sections": ["header", "parameters", "pass_fail"],
            "graphs": [],
            "tables": [],
            "format": "pdf",
            "result": "PASS",
        })
        assert r.status_code == 200
        assert r.headers["content-type"] == "application/pdf"
        assert r.content.startswith(b"%PDF")
        assert 'filename="agnipariksha-abc.pdf"' in r.headers["content-disposition"]


def test_docx_endpoint_v2_shape() -> None:
    with TestClient(app) as c:
        r = c.post("/api/reports/generate", json={
            "run_id": "docx-1",
            "format": "docx",
            "sections": ["header", "parameters"],
        })
        assert r.status_code == 200
        assert "wordprocessingml" in r.headers["content-type"]
        # DOCX files are ZIP archives — magic bytes 'PK'.
        assert r.content[:2] == b"PK"


def test_legacy_payload_still_works() -> None:
    """Older callers send testId/testName/moduleId without sections[]."""
    with TestClient(app) as c:
        r = c.post("/api/reports/generate", json={
            "testId": "legacy-7",
            "testName": "Legacy Test",
            "standard": "IEC 61215-2",
            "moduleId": "MOD-9",
            "format": "pdf",
        })
        assert r.status_code == 200
        assert r.content.startswith(b"%PDF")
        # No sections[] means "all sections" — should be a sizeable doc.
        assert len(r.content) > 1500


def test_sections_listing_endpoint() -> None:
    with TestClient(app) as c:
        r = c.get("/api/reports/sections")
        assert r.status_code == 200
        body = r.json()
        ids = {s["id"] for s in body["sections"]}
        assert "graphs" in ids and "tables" in ids and "signature" in ids
        graph_ids = {g["id"] for g in body["graphs"]}
        assert {"voltage", "current", "power", "vf_vs_t"}.issubset(graph_ids)


def test_unsupported_format_rejected() -> None:
    with TestClient(app) as c:
        r = c.post("/api/reports/generate", json={
            "run_id": "x", "format": "xls",
        })
        assert r.status_code == 400


def test_three_sections_toggled_off_via_endpoint() -> None:
    """End-to-end mirror of the Playwright spec: toggle 3 off, assert delta."""
    with TestClient(app) as c:
        full = c.post("/api/reports/generate", json={
            "run_id": "delta",
            "format": "pdf",
            "readings": [
                {"timestamp": float(i), "voltage": 40.0, "current": 8.0,
                 "power": 320.0 - i * 0.05, "temperature": 25.0}
                for i in range(40)
            ],
        })
        trimmed = c.post("/api/reports/generate", json={
            "run_id": "delta",
            "format": "pdf",
            "sections": [s for s in ALL_SECTIONS
                         if s not in {"graphs", "tables", "photos"}],
            "readings": [
                {"timestamp": float(i), "voltage": 40.0, "current": 8.0,
                 "power": 320.0 - i * 0.05, "temperature": 25.0}
                for i in range(40)
            ],
        })
        assert full.status_code == 200 and trimmed.status_code == 200
        assert len(full.content) - len(trimmed.content) > 1000
