"""Tests for the reliability analytics module.

Synthetic data is generated with a fixed-seed PRNG so failures are
reproducible across CI runs.
"""
from __future__ import annotations

import math
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.reliability import (  # noqa: E402
    MaintenanceTicket,
    ReliabilityStore,
    SparePart,
    availability,
    compute_mtbf_mttr,
    equipment_health,
    get_store,
    inventory as inv,
    weibull_cdf,
    weibull_fit,
)
from backend.main import app  # noqa: E402


SEED = 20260512  # deterministic across runs
EPOCH = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _weibull_sample(rng: random.Random, shape: float, scale: float) -> float:
    """Inverse-CDF Weibull sample (no numpy)."""
    u = rng.random()
    while u <= 0.0:
        u = rng.random()
    return scale * (-math.log(u)) ** (1.0 / shape)


def _make_history(
    equipment_id: str,
    n_failures: int,
    shape: float,
    scale_hours: float,
    repair_mean_hours: float,
    seed: int,
) -> List[MaintenanceTicket]:
    rng = random.Random(seed)
    t = EPOCH
    tickets: List[MaintenanceTicket] = []
    for _ in range(n_failures):
        gap = _weibull_sample(rng, shape, scale_hours)
        t = t + timedelta(hours=gap)
        repair = max(0.1, rng.gauss(repair_mean_hours, repair_mean_hours * 0.2))
        tickets.append(
            MaintenanceTicket(
                equipment_id=equipment_id,
                kind="failure",
                opened_at=t,
                closed_at=t + timedelta(hours=repair),
                status="closed",
            )
        )
    return tickets


@pytest.fixture(autouse=True)
def _clear_store():
    store = get_store()
    store.reset()
    yield
    store.reset()


# --- mtbf -------------------------------------------------------------

def test_mtbf_mttr_deterministic_synthetic():
    tickets = _make_history(
        "pv6000-A", n_failures=40, shape=1.8, scale_hours=200.0,
        repair_mean_hours=3.0, seed=SEED,
    )
    mtbf, mttr = compute_mtbf_mttr(tickets)
    assert mtbf is not None and mttr is not None
    # With shape=1.8, scale=200 -> mean ≈ 200 * Γ(1+1/1.8) ≈ 177.9 h
    assert 130 < mtbf < 230
    assert 2.0 < mttr < 4.0
    a = availability(mtbf, mttr)
    assert 0.95 < a < 1.0


def test_availability_handles_missing():
    assert availability(None, None) == 1.0
    assert availability(100.0, None) == 1.0
    assert availability(100.0, 100.0) == 0.5


def test_no_failures_yields_none():
    assert compute_mtbf_mttr([]) == (None, None)


# --- weibull ----------------------------------------------------------

def test_weibull_fit_recovers_parameters():
    rng = random.Random(SEED + 1)
    true_k, true_lam = 2.0, 150.0
    xs = [_weibull_sample(rng, true_k, true_lam) for _ in range(500)]
    fit = weibull_fit(xs, window=None)
    assert fit is not None
    k, lam = fit
    # MLE on 500 samples should be reasonably tight.
    assert abs(k - true_k) / true_k < 0.15
    assert abs(lam - true_lam) / true_lam < 0.10


def test_weibull_fit_too_few_samples():
    assert weibull_fit([10.0]) is None
    assert weibull_fit([]) is None
    assert weibull_fit([5.0, 5.0, 5.0]) is None  # zero variance


def test_weibull_cdf_monotone():
    # F(0)=0, F(inf)→1, monotone non-decreasing
    last = 0.0
    for t in (0.0, 10.0, 50.0, 100.0, 1000.0):
        v = weibull_cdf(t, 1.5, 100.0)
        assert v >= last
        last = v
    assert weibull_cdf(100.0, 1.0, 100.0) == pytest.approx(1 - math.exp(-1))


# --- predictive -------------------------------------------------------

def test_equipment_health_shape():
    tickets = _make_history(
        "pv6000-A", n_failures=30, shape=2.2, scale_hours=120.0,
        repair_mean_hours=1.5, seed=SEED,
    )
    now = tickets[-1].opened_at + timedelta(hours=80)
    h = equipment_health("pv6000-A", tickets, now=now)
    assert h.equipment_id == "pv6000-A"
    assert h.failures == 30
    assert h.mtbf_hours is not None
    assert h.mttr_hours is not None
    assert 0.0 <= h.risk_score <= 100.0
    assert 0.0 < h.availability <= 1.0
    assert h.next_service_due is not None
    assert h.next_service_due > now - timedelta(seconds=1)
    assert h.weibull_shape is not None and h.weibull_shape > 0
    assert h.weibull_scale_hours is not None and h.weibull_scale_hours > 0


def test_risk_increases_with_time_since_failure():
    tickets = _make_history(
        "pv6000-B", n_failures=40, shape=2.5, scale_hours=100.0,
        repair_mean_hours=2.0, seed=SEED + 2,
    )
    last = tickets[-1].opened_at
    early = equipment_health("pv6000-B", tickets, now=last + timedelta(hours=1))
    late = equipment_health("pv6000-B", tickets, now=last + timedelta(hours=400))
    assert late.risk_score >= early.risk_score


# --- inventory --------------------------------------------------------

def test_inventory_crud_and_autoreorder():
    store = get_store()
    p = inv.create_part(
        sku="FUSE-15A", name="15A blade fuse", quantity=10,
        reorder_level=3, reorder_qty=20, store=store,
    )
    assert isinstance(p, SparePart) and p.quantity == 10

    # Update by patch — no reorder yet.
    inv.update_part(p.id, quantity=5, store=store)
    reorders = [t for t in store.list_tickets() if t.kind == "reorder"]
    assert reorders == []

    # Consume past the reorder threshold — exactly one ticket should appear.
    inv.consume_part(p.id, count=3, store=store)
    reorders = [t for t in store.list_tickets() if t.kind == "reorder"]
    assert len(reorders) == 1
    assert reorders[0].equipment_id == "reorder:FUSE-15A"
    assert "FUSE-15A" in reorders[0].note

    # Further consumption while the ticket is open must NOT duplicate.
    inv.consume_part(p.id, count=1, store=store)
    reorders = [t for t in store.list_tickets() if t.kind == "reorder"]
    assert len(reorders) == 1

    assert inv.delete_part(p.id, store=store) is True
    assert inv.delete_part(p.id, store=store) is False


def test_check_reorder_runs_globally():
    store = get_store()
    inv.create_part(sku="O-RING-22", name="O-Ring 22mm", quantity=0,
                    reorder_level=2, store=store)
    inv.create_part(sku="GASKET-A", name="Gasket A", quantity=50,
                    reorder_level=2, store=store)
    inv.check_reorder(store=store)
    reorders = [t for t in store.list_tickets() if t.kind == "reorder"]
    assert len(reorders) == 1
    assert reorders[0].equipment_id == "reorder:O-RING-22"


# --- HTTP API ---------------------------------------------------------

def test_api_equipment_and_inventory_flow():
    with TestClient(app) as c:
        # Create two failure tickets for the same equipment.
        t0 = EPOCH.isoformat()
        t1 = (EPOCH + timedelta(hours=24)).isoformat()
        for opened in (t0, t1):
            r = c.post("/api/reliability/tickets", json={
                "equipment_id": "pump-01",
                "kind": "failure",
                "opened_at": opened,
                "closed_at": opened,
                "status": "closed",
            })
            assert r.status_code == 200

        r = c.get("/api/reliability/equipment")
        assert r.status_code == 200
        rows = r.json()
        assert any(row["equipment_id"] == "pump-01" for row in rows)

        # Spare part lifecycle.
        r = c.post("/api/reliability/parts", json={
            "sku": "BELT-10", "name": "Drive belt 10mm",
            "quantity": 1, "reorder_level": 2, "reorder_qty": 10,
        })
        assert r.status_code == 200
        part = r.json()
        # qty<=reorder_level on create -> auto-reorder ticket exists.
        tk = c.get("/api/reliability/tickets",
                   params={"equipment_id": "reorder:BELT-10"}).json()
        assert len(tk) == 1 and tk[0]["kind"] == "reorder"

        r = c.patch(f"/api/reliability/parts/{part['id']}",
                    json={"quantity": 99})
        assert r.status_code == 200 and r.json()["quantity"] == 99

        r = c.delete(f"/api/reliability/parts/{part['id']}")
        assert r.status_code == 200 and r.json()["deleted"] is True


def test_api_unknown_equipment_404():
    with TestClient(app) as c:
        r = c.get("/api/reliability/equipment/missing-xyz")
        assert r.status_code == 404


def test_store_is_isolated_between_tests():
    # The autouse fixture must reset the singleton.
    assert get_store().list_parts() == []
    assert get_store().list_tickets() == []
