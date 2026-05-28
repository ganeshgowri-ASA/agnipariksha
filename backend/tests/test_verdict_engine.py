# Tab-4 Analysis Verdict Engine — DEMO-only unit + API tests: all 3 verdict
# branches per evaluator, plus recompute -> persist -> GET and synthetic DEMO.
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app.analysis.verdict import all_evaluators, get
from backend.main import app


def test_four_evaluators_registered_and_importable() -> None:
    assert set(all_evaluators().keys()) == {"tc", "hf", "pid", "letid"}


# (test_type, metrics, expected_status) — every evaluator hits all 3 branches.
_CASES = [
    ("tc", {"pre_pmax_w": 300, "post_pmax_w": 290, "insulation_resistance_mohm_m2": 50}, "PASS"),
    ("tc", {"pre_pmax_w": 300, "post_pmax_w": 270, "insulation_resistance_mohm_m2": 50}, "FAIL"),
    ("tc", {"pre_pmax_w": 300, "post_pmax_w": 298}, "INCONCLUSIVE"),  # IR missing
    ("hf", {"pre_pmax_w": 300, "post_pmax_w": 293}, "PASS"),
    ("hf", {"pre_pmax_w": 300, "post_pmax_w": 250}, "FAIL"),
    ("hf", {"pre_pmax_w": 0, "post_pmax_w": 0}, "INCONCLUSIVE"),
    ("pid", {"pre_pmax_w": 300, "post_pmax_w": 295}, "PASS"),
    ("pid", {"pre_pmax_w": 300, "post_pmax_w": 200}, "FAIL"),
    ("pid", {"pre_pmax_w": 0, "post_pmax_w": 10}, "INCONCLUSIVE"),
    ("letid", {"pre_pmax_w": 300, "post_pmax_w": 297}, "PASS"),
    ("letid", {"pre_pmax_w": 300, "post_pmax_w": 280}, "FAIL"),
    ("letid", {"pre_pmax_w": 0, "post_pmax_w": 0}, "INCONCLUSIVE"),
]


@pytest.mark.parametrize("test_type,metrics,expected", _CASES)
def test_evaluator_branches(test_type, metrics, expected) -> None:
    v = get(test_type)(metrics)
    assert v.status.value == expected, (test_type, metrics)
    assert v.clause_id and v.clause_text
    assert v.threshold == -5.0


def test_recompute_persists_get_serves_and_demo(isolated_db_url) -> None:
    from backend.config import get_settings
    from backend.db.session import init_db

    get_settings.cache_clear()
    init_db()
    with TestClient(app) as c:
        r = c.post("/api/analysis/recompute", json={
            "run_id": "RUN-1", "test_type": "tc",
            "metrics": {"pre_pmax_w": 300, "post_pmax_w": 290, "insulation_resistance_mohm_m2": 55},
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "PASS" and body["run_id"] == "RUN-1"
        assert body["clause_id"] == "IEC 61215-2 MQT 11"

        g = c.get("/api/analysis/RUN-1")
        assert g.status_code == 200, g.text
        assert g.json()["status"] == "PASS" and g.json()["clause_id"] == body["clause_id"]

        # Synthetic DEMO path (no metrics) still yields a valid persisted verdict.
        d = c.post("/api/analysis/recompute", json={"run_id": "DEMO-X", "test_type": "letid"})
        assert d.status_code == 200, d.text
        assert d.json()["status"] in {"PASS", "FAIL", "INCONCLUSIVE"}
