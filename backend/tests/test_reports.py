"""Tests for the Tab 5 IEC report endpoints (DEMO fixtures only).

Pins the report contract: the HTML twin and the PDF are rendered from the
same fixtures, the verdict pill maps INSUFFICIENT_DATA -> INCONCLUSIVE, and
every traceability field (module id, run id, git sha) reaches the output.
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

RUN_ID = "DEMO-RUN-001"


@pytest.fixture(scope="module")
def client() -> TestClient:
    app = FastAPI()
    app.include_router(reports_router)
    return TestClient(app)


def test_list_reports_exposes_demo_run(client: TestClient) -> None:
    body = client.get("/api/reports").json()
    assert any(r["run_id"] == RUN_ID for r in body)


def test_overall_is_fail_when_any_test_fails() -> None:
    run = get_run(RUN_ID)
    assert run is not None
    verdicts = {t.verdict for t in run.tests}
    assert "FAIL" in verdicts          # humidity-freeze drops ~6.2%
    assert "INCONCLUSIVE" in verdicts  # bypass-diode has no temperature data
    assert run.overall == "FAIL"


def test_html_twin_carries_every_section(client: TestClient) -> None:
    r = client.get(f"/api/reports/{RUN_ID}.html")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    html = r.text
    run = get_run(RUN_ID)
    assert run is not None
    # Cover + traceability fields.
    for token in (run.module_id, run.run_id, run.test_id, "IST", "DEMO REPORT", "Sign-off"):
        assert token in html
    # Every test row + its overlay graph (base64 PNG) is present.
    for t in run.tests:
        assert t.name in html
    assert html.count("data:image/png;base64,") == len(run.tests)
    assert "INCONCLUSIVE" in html


def test_pdf_twin_is_valid_pdf(client: TestClient) -> None:
    r = client.get(f"/api/reports/{RUN_ID}.pdf")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content[:5] == b"%PDF-"
    assert len(r.content) > 2000  # contains embedded chart images


def test_unknown_run_id_404(client: TestClient) -> None:
    assert client.get("/api/reports/NOPE.html").status_code == 404
    assert client.get("/api/reports/NOPE.pdf").status_code == 404
