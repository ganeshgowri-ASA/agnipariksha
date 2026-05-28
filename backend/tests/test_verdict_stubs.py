# Tab-4 PR-2 — DEMO-only stub evaluators. Each new test type returns
# INCONCLUSIVE with its IEC clause_id and null measured/threshold/margin
# until an owner signs the thresholds.
from __future__ import annotations

import pytest

from backend.app.analysis.verdict import VerdictStatus, all_evaluators, get

# (registry key, expected clause_id)
_STUBS = [
    ("bdt", "IEC 61215 BDT"),
    ("rcot", "IEC 61730-2 MST 26"),
    ("el", "IEC TS 60904-13"),
    ("ir", "IEC 61215 IR/forward-bias thermography"),
    ("gc", "IEC 61730-1 Annex C"),
    ("eq_bond", "IEC 61730-1 5.3.4"),
]


@pytest.mark.parametrize("test_type,clause_id", _STUBS)
def test_stub_returns_inconclusive_with_clause(test_type, clause_id) -> None:
    v = get(test_type)({})
    assert v.status is VerdictStatus.INCONCLUSIVE
    assert v.clause_id == clause_id
    assert v.clause_text.startswith("TODO")
    assert v.measured is None and v.threshold is None and v.margin is None
    assert v.evidence_refs == []


def test_full_registry_has_all_ten_evaluators() -> None:
    assert set(all_evaluators()) == {
        "tc", "hf", "pid", "letid",
        "bdt", "rcot", "el", "ir", "gc", "eq_bond",
    }
