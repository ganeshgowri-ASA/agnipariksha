"""Smoke tests for the IEC report builder.

The intent is to lock the *shape* of the output PDF rather than its
pixel content. We assert:

- PDF magic header `%PDF-` is present
- key metadata fields show up in the byte stream (operator/customer/result)
- A session with zero readings still produces a valid PDF
- The FastAPI route returns 200 with `application/pdf`
"""
from __future__ import annotations

import sys
from pathlib import Path

from io import BytesIO

import pytest
from fastapi.testclient import TestClient

# Ensure the `backend` package imports work whether pytest is run from the
# repo root or from inside `backend/`.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:
    from backend.reports import build_iec_report
    from backend.main import app
    PREFIX = "backend."
except ImportError:
    from reports import build_iec_report  # type: ignore[no-redef]
    from main import app  # type: ignore[no-redef]
    PREFIX = ""


def _sample_payload(test_type: str = "thermal_cycling") -> dict:
    """A fully-populated session payload mirroring frontend TestSession + extras."""
    return {
        "id": "TC-1717000000000",
        "testType": test_type,
        "iecClause": "MQT 11",
        "startTime": 1_717_000_000_000,
        "endTime":   1_717_007_200_000,
        "status": "pass",
        "result": "PASS",
        "operatorName": "Mounika Mandru",
        "operatorId": "EMP-001",
        "companyName": "ASA Test Labs",
        "customerName": "Reliance Industries Limited",
        "equipmentId": "ITECH PV6000 IT6005C-80-150 + ESPEC SH-242",
        "methodReference": "SOW-2026-PV-RIL-01",
        "moduleSerial": "MOD-77001",
        "notes": "Sample run for ReportLab smoke test.",
        "setpoints": {"cycles": 200, "tMin": -40, "tMax": 85, "Isc": 9.5, "rampRate": 100},
        "kpis": {"completedCycles": 200, "worstRampCph": 94.2, "result": "PASS"},
        "readings": [
            {"timestamp": 1_717_000_000_000, "voltage": 0.0, "current": 0.0, "power": 0.0, "temperature": -40},
            {"timestamp": 1_717_000_100_000, "voltage": 48.0, "current": 9.5, "power": 456.0, "temperature": 80},
            {"timestamp": 1_717_000_200_000, "voltage": 48.0, "current": 9.5, "power": 456.0, "temperature": 85},
        ],
    }


def test_builder_returns_pdf_bytes() -> None:
    pdf = build_iec_report(_sample_payload())
    assert isinstance(pdf, bytes)
    assert pdf.startswith(b"%PDF-"), "missing PDF magic header"
    assert len(pdf) > 1000, "PDF suspiciously small"


def test_builder_propagates_operator_and_customer_into_metadata() -> None:
    """Author + Title in the PDF Info dictionary should carry through.

    ReportLab compresses the body streams (FlateDecode) so the
    operator name does not appear as ASCII in the byte stream — but
    the document Title (which we set to ``standard — session_id``)
    AND the Author (which we set to the company name) are stored in
    the Info dictionary as plain ASCII and are stable to assert on.
    """
    pdf = build_iec_report(_sample_payload())
    # PDF Info dictionary uses parens: e.g.  /Author (ASA Test Labs)
    # Title looks like:                       /Title (IEC 61215-2 ... )
    assert b"ASA Test Labs" in pdf, "company name should reach PDF metadata"
    assert b"IEC 61215-2" in pdf, "standard string should reach PDF metadata"
    assert b"TC-1717000000000" in pdf, "session id should reach PDF metadata"


def test_builder_extractable_text_includes_real_metadata() -> None:
    """Round-trip via pypdf to extract text from the PDF body and verify
    operator / customer / result text actually rendered onto the page.

    Skipped when pypdf isn't installed in the runtime image — the
    metadata-dict test above already covers the no-pypdf case.
    """
    pypdf = pytest.importorskip("pypdf")
    pdf = build_iec_report(_sample_payload())
    reader = pypdf.PdfReader(BytesIO(pdf))
    text = "".join(page.extract_text() or "" for page in reader.pages)
    assert "Mounika" in text
    assert "Reliance" in text
    assert "PV6000" in text
    assert "PASS" in text


def test_builder_with_no_readings_still_succeeds() -> None:
    payload = _sample_payload()
    payload["readings"] = []
    pdf = build_iec_report(payload)
    assert pdf.startswith(b"%PDF-")


def test_builder_with_minimal_payload() -> None:
    """Even a truly minimal payload (just id+testType) should not crash."""
    pdf = build_iec_report({"id": "X", "testType": "tc"})
    assert pdf.startswith(b"%PDF-")
    # Default operator/customer values present
    assert b"Anonymous" in pdf or b"N/A" in pdf


def test_route_returns_pdf_for_valid_payload() -> None:
    with TestClient(app) as c:
        r = c.post("/api/reports/generate", json=_sample_payload())
        assert r.status_code == 200, r.text
        assert r.headers["content-type"] == "application/pdf"
        assert r.headers["content-disposition"].startswith("attachment;")
        assert r.content.startswith(b"%PDF-")


def test_route_rejects_invalid_payload() -> None:
    with TestClient(app) as c:
        # Missing `id` — must be 400.
        r = c.post("/api/reports/generate", json={"testType": "tc"})
        assert r.status_code == 400


@pytest.mark.parametrize("tt", ["thermal_cycling", "humidity_freeze", "gct", "letid", "bdt"])
def test_builder_covers_multiple_test_types(tt: str) -> None:
    pdf = build_iec_report(_sample_payload(tt))
    assert pdf.startswith(b"%PDF-")


def test_builder_includes_iso17025_declarations() -> None:
    """The §7.8 block must land in the PDF: method+edition, environmental
    conditions, uncertainty, deviations, authorisation, and the
    results-relate-only statement."""
    pypdf = pytest.importorskip("pypdf")
    payload = _sample_payload("gct")
    payload["envConditions"] = "23 degC / 45 %RH ambient"
    payload["approvedBy"] = "quality.mgr"
    payload["approverRole"] = "Quality Manager"
    pdf = build_iec_report(payload)
    reader = pypdf.PdfReader(BytesIO(pdf))
    text = "".join(page.extract_text() or "" for page in reader.pages)
    assert "ISO/IEC 17025 declarations" in text
    assert "61730-2:2023" in text  # method cites the current edition
    assert "23 degC / 45 %RH ambient" in text
    assert "uncertainty" in text.lower()
    assert "Deviations" in text
    assert "quality.mgr" in text and "Quality Manager" in text
    assert "relate only to the item" in text


def test_builder_iso17025_signature_line_when_unapproved() -> None:
    pypdf = pytest.importorskip("pypdf")
    pdf = build_iec_report(_sample_payload())  # no approvedBy
    reader = pypdf.PdfReader(BytesIO(pdf))
    text = "".join(page.extract_text() or "" for page in reader.pages)
    assert "name, function, signature" in text
