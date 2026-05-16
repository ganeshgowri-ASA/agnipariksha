"""Tests for the procurement / PO API (G5)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.main import app  # noqa: E402
from backend.procurement import store  # noqa: E402


@pytest.fixture(autouse=True)
def _clean_store():
    store.reset()
    yield
    store.reset()


def _client() -> TestClient:
    return TestClient(app)


def _make(
    c: TestClient,
    po_number: str,
    *,
    vendor: str = "Acme Corp",
    rfq_ref: str | None = "RFQ-2026-001",
    total: float = 100.00,
    currency: str = "INR",
    status: str = "draft",
    eta: str | None = "2026-06-30",
) -> dict:
    r = c.post(
        "/api/procurement/po",
        json={
            "po_number": po_number,
            "vendor": vendor,
            "rfq_ref": rfq_ref,
            "total": total,
            "currency": currency,
            "status": status,
            "eta": eta,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_create_purchase_order() -> None:
    with _client() as c:
        body = _make(c, "PO-2026-T01", total=1234.56, status="issued")
        assert body["id"].startswith("PO-")
        assert body["po_number"] == "PO-2026-T01"
        assert body["status"] == "issued"
        assert body["total"] == 1234.56
        assert body["rfq_ref"] == "RFQ-2026-001"
        assert body["eta"] == "2026-06-30"
        assert body["currency"] == "INR"


def test_blank_po_number_rejected() -> None:
    with _client() as c:
        r = c.post(
            "/api/procurement/po",
            json={"po_number": "   ", "vendor": "X", "total": 10},
        )
        assert r.status_code == 422


def test_negative_total_rejected() -> None:
    with _client() as c:
        r = c.post(
            "/api/procurement/po",
            json={"po_number": "P1", "vendor": "X", "total": -1},
        )
        assert r.status_code == 422


def test_invalid_status_rejected() -> None:
    with _client() as c:
        r = c.post(
            "/api/procurement/po",
            json={
                "po_number": "P1",
                "vendor": "X",
                "total": 1,
                "status": "bogus",
            },
        )
        assert r.status_code == 422


def test_list_empty_returns_envelope() -> None:
    with _client() as c:
        r = c.get("/api/procurement/po")
        assert r.status_code == 200
        body = r.json()
        assert body == {
            "items": [],
            "total": 0,
            "page": 1,
            "size": 25,
            "pages": 0,
        }


def test_list_default_pagination() -> None:
    with _client() as c:
        for i in range(5):
            _make(c, f"PO-2026-{i:03d}")
        r = c.get("/api/procurement/po")
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 5
        assert body["page"] == 1
        assert body["size"] == 25
        assert body["pages"] == 1
        assert len(body["items"]) == 5


def test_list_paginates_with_page_and_size() -> None:
    with _client() as c:
        for i in range(7):
            _make(c, f"PO-2026-{i:03d}")
        r1 = c.get("/api/procurement/po?page=1&size=3")
        r2 = c.get("/api/procurement/po?page=2&size=3")
        r3 = c.get("/api/procurement/po?page=3&size=3")
        assert r1.status_code == r2.status_code == r3.status_code == 200
        b1, b2, b3 = r1.json(), r2.json(), r3.json()

        for b in (b1, b2, b3):
            assert b["total"] == 7
            assert b["size"] == 3
            assert b["pages"] == 3
        assert b1["page"] == 1 and len(b1["items"]) == 3
        assert b2["page"] == 2 and len(b2["items"]) == 3
        assert b3["page"] == 3 and len(b3["items"]) == 1

        # No overlap across pages.
        ids = [it["id"] for it in b1["items"] + b2["items"] + b3["items"]]
        assert len(ids) == len(set(ids)) == 7


def test_list_page_beyond_last_is_empty() -> None:
    with _client() as c:
        for i in range(3):
            _make(c, f"PO-2026-{i:03d}")
        r = c.get("/api/procurement/po?page=5&size=10")
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 3
        assert body["page"] == 5
        assert body["items"] == []


def test_list_rejects_zero_page() -> None:
    with _client() as c:
        r = c.get("/api/procurement/po?page=0&size=10")
        assert r.status_code == 422


def test_list_rejects_oversize_size() -> None:
    with _client() as c:
        r = c.get("/api/procurement/po?page=1&size=10000")
        assert r.status_code == 422


def test_get_one() -> None:
    with _client() as c:
        body = _make(c, "PO-2026-T99")
        r = c.get(f"/api/procurement/po/{body['id']}")
        assert r.status_code == 200
        assert r.json()["po_number"] == "PO-2026-T99"


def test_get_missing_404() -> None:
    with _client() as c:
        r = c.get("/api/procurement/po/PO-DOESNOTEXIST")
        assert r.status_code == 404


def test_list_newest_first() -> None:
    with _client() as c:
        a = _make(c, "PO-A")
        b = _make(c, "PO-B")
        c2 = _make(c, "PO-C")
        r = c.get("/api/procurement/po")
        items = r.json()["items"]
        assert [it["po_number"] for it in items] == ["PO-C", "PO-B", "PO-A"]
        assert items[0]["id"] == c2["id"]
        assert items[-1]["id"] == a["id"]
