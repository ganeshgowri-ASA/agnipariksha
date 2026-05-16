"""Tests for the procurement RFQ pagination endpoint."""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.procurement import RFQ, get_store  # noqa: E402
from backend.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def _seed_store():
    """Replace the demo seed with a deterministic 30-row fixture."""
    store = get_store()
    store.reset()
    base = datetime(2026, 5, 1, tzinfo=timezone.utc)
    for i in range(30):
        store.add(
            RFQ(
                rfq_no=f"RFQ-T-{i:03d}",
                vendor=f"vendor-{i % 3}",
                items=i + 1,
                total=float(100 * (i + 1)),
                status="draft",
                created_at=base + timedelta(hours=i),
            )
        )
    yield
    store.reset()


def test_default_page_size_is_25():
    with TestClient(app) as c:
        r = c.get("/api/procurement/rfq")
        assert r.status_code == 200
        body = r.json()
        assert body["page"] == 1
        assert body["size"] == 25
        assert body["total"] == 30
        assert len(body["items"]) == 25


def test_pagination_returns_remainder_on_last_page():
    with TestClient(app) as c:
        r = c.get("/api/procurement/rfq", params={"page": 2, "size": 25})
        assert r.status_code == 200
        body = r.json()
        assert body["page"] == 2
        assert len(body["items"]) == 5


def test_items_sorted_by_created_at_desc():
    with TestClient(app) as c:
        body = c.get("/api/procurement/rfq", params={"page": 1, "size": 5}).json()
        ts = [row["created_at"] for row in body["items"]]
        assert ts == sorted(ts, reverse=True)


def test_empty_store_returns_zero_total():
    get_store().reset()
    with TestClient(app) as c:
        body = c.get("/api/procurement/rfq").json()
        assert body == {"items": [], "page": 1, "size": 25, "total": 0}


def test_invalid_params_rejected():
    with TestClient(app) as c:
        assert c.get("/api/procurement/rfq", params={"page": 0}).status_code == 422
        assert c.get("/api/procurement/rfq", params={"size": 0}).status_code == 422
        assert c.get("/api/procurement/rfq", params={"size": 999}).status_code == 422
