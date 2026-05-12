"""Smoke tests for the SQLModel schema (V2-S2).

Validates that every table can round-trip an instance against an
in-memory SQLite engine and that the headline indexes / unique
constraints are honoured.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from backend.db.models import (
    AIThread,
    AuditLog,
    BarcodeScan,
    ComplaintTicket,
    Equipment,
    MaintenanceTicket,
    Module,
    Operator,
    Report,
    Schedule,
    SparePart,
    TelemetrySample,
    TestRun,
    TestStatus,
    TicketStatus,
)


def test_all_13_tables_are_registered(sqlite_engine) -> None:
    from sqlmodel import SQLModel

    expected = {
        "module", "test_run", "telemetry_sample", "report", "operator",
        "equipment", "spare_part", "maintenance_ticket", "complaint_ticket",
        "ai_thread", "audit_log", "barcode_scan", "schedule",
    }
    found = set(SQLModel.metadata.tables.keys())
    assert expected.issubset(found), f"missing tables: {expected - found}"


def test_module_unique_serial(db_session: Session) -> None:
    db_session.add(Module(serial_no="SN-1", manufacturer="Acme"))
    db_session.commit()
    db_session.add(Module(serial_no="SN-1", manufacturer="Other"))
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_test_run_roundtrip_with_samples_and_report(db_session: Session) -> None:
    mod = Module(serial_no="SN-42", model="X-300", pmax_w=320.5)
    op = Operator(badge_id="B-1", name="Alice")
    eq = Equipment(asset_tag="PSU-1", name="ITECH PV6000", kind="psu")
    db_session.add_all([mod, op, eq])
    db_session.commit()

    run = TestRun(
        test_type="tc",
        standard="IEC 61215 MQT11",
        mqt="MQT11",
        status=TestStatus.RUNNING,
        module_id=mod.id,
        operator_id=op.id,
        equipment_id=eq.id,
        started_at=datetime(2026, 5, 1, 12, 0, 0),
        params={"cycles": 200, "t_min": -40, "t_max": 85},
    )
    db_session.add(run)
    db_session.commit()
    db_session.refresh(run)
    assert run.id is not None

    db_session.add_all(
        [
            TelemetrySample(
                test_run_id=run.id,
                ts=datetime(2026, 5, 1, 12, 0, i),
                step_no=1,
                voltage=48.1 + i * 0.01,
                current=5.2,
                power=250.12,
                temperature=25.0 + i,
                tags={"phase": "warmup"},
            )
            for i in range(3)
        ]
    )
    db_session.add(
        Report(test_run_id=run.id, fmt="pdf", path="reports/x.pdf", sha256="a" * 64)
    )
    db_session.commit()

    samples = db_session.exec(
        select(TelemetrySample).where(TelemetrySample.test_run_id == run.id)
    ).all()
    assert len(samples) == 3
    assert all(s.tags == {"phase": "warmup"} for s in samples)

    reps = db_session.exec(select(Report).where(Report.test_run_id == run.id)).all()
    assert len(reps) == 1
    assert reps[0].fmt == "pdf"
    assert run.params and run.params["cycles"] == 200


def test_test_run_csv_path_is_unique(db_session: Session) -> None:
    db_session.add(TestRun(test_type="hf", csv_path="data/runs/foo.csv"))
    db_session.commit()
    db_session.add(TestRun(test_type="hf", csv_path="data/runs/foo.csv"))
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_ticket_and_misc_tables_persist(db_session: Session) -> None:
    op = Operator(badge_id="B-9", name="Bob")
    mod = Module(serial_no="SN-99")
    db_session.add_all([op, mod])
    db_session.commit()

    db_session.add_all(
        [
            SparePart(sku="FUSE-25A", name="25A fuse", qty_on_hand=10, reorder_level=2),
            MaintenanceTicket(
                title="recalibrate PSU",
                opened_by=op.id,
                severity="high",
                status=TicketStatus.OPEN,
            ),
            ComplaintTicket(
                module_id=mod.id,
                subject="output drift",
                status=TicketStatus.IN_PROGRESS,
            ),
            AIThread(title="why did MQT12 fail?", operator_id=op.id, messages={"m": []}),
            AuditLog(actor="alice", action="login", entity="operator", entity_id=str(op.id)),
            BarcodeScan(code="MOD-SN-99", kind="module", scanned_by=op.id),
            Schedule(
                test_type="bdt",
                module_id=mod.id,
                operator_id=op.id,
                starts_at=datetime.utcnow() + timedelta(days=1),
            ),
        ]
    )
    db_session.commit()

    assert db_session.exec(select(SparePart)).first().sku == "FUSE-25A"
    assert db_session.exec(select(MaintenanceTicket)).first().status == TicketStatus.OPEN
    assert db_session.exec(select(ComplaintTicket)).first().status == TicketStatus.IN_PROGRESS
    assert db_session.exec(select(AIThread)).first().messages == {"m": []}
    assert db_session.exec(select(AuditLog)).first().action == "login"
    assert db_session.exec(select(BarcodeScan)).first().code == "MOD-SN-99"
    assert db_session.exec(select(Schedule)).first().test_type == "bdt"
