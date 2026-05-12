"""SQLModel ORM definitions for Agnipariksha V2-S2.

The CSV write path remains the source of truth for telemetry and run output;
these tables are a queryable mirror used by reports, dashboards, and the
maintenance/ops UI. Foreign keys are nullable wherever the row may exist
independently of its parent (e.g. a TestRun created via backfill does not
require an Operator).
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import Column
from sqlalchemy.types import JSON
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.utcnow()


class TestStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    PASSED = "passed"
    FAILED = "failed"
    STOPPED = "stopped"
    ABORTED = "aborted"


class TicketStatus(str, Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    CLOSED = "closed"


# ---------------------------------------------------------------------------
# Core domain
# ---------------------------------------------------------------------------
class Module(SQLModel, table=True):
    __tablename__ = "module"

    id: Optional[int] = Field(default=None, primary_key=True)
    serial_no: str = Field(index=True, unique=True, max_length=128)
    manufacturer: Optional[str] = Field(default=None, max_length=200)
    model: Optional[str] = Field(default=None, max_length=200)
    pmax_w: Optional[float] = None
    voc_v: Optional[float] = None
    isc_a: Optional[float] = None
    vmpp_v: Optional[float] = None
    impp_a: Optional[float] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=_utcnow, nullable=False)


class Operator(SQLModel, table=True):
    __tablename__ = "operator"

    id: Optional[int] = Field(default=None, primary_key=True)
    badge_id: str = Field(index=True, unique=True, max_length=64)
    name: str = Field(max_length=200)
    email: Optional[str] = Field(default=None, max_length=320)
    role: str = Field(default="technician", max_length=32)
    active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=_utcnow, nullable=False)


class Equipment(SQLModel, table=True):
    __tablename__ = "equipment"

    id: Optional[int] = Field(default=None, primary_key=True)
    asset_tag: str = Field(index=True, unique=True, max_length=64)
    name: str = Field(max_length=200)
    kind: str = Field(default="psu", max_length=64)  # psu, chamber, dmm, ...
    vendor: Optional[str] = Field(default=None, max_length=200)
    model: Optional[str] = Field(default=None, max_length=200)
    serial_no: Optional[str] = Field(default=None, max_length=128)
    location: Optional[str] = Field(default=None, max_length=200)
    last_calibrated_at: Optional[datetime] = None
    calibration_due_at: Optional[datetime] = None
    active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=_utcnow, nullable=False)


class TestRun(SQLModel, table=True):
    __tablename__ = "test_run"

    id: Optional[int] = Field(default=None, primary_key=True)
    # Used by the CSV backfill as an idempotency key. The path is relative to
    # the data root so backups/restores remain portable.
    csv_path: Optional[str] = Field(default=None, index=True, unique=True, max_length=1024)
    test_type: str = Field(index=True, max_length=20)  # tc/hf/letid/bdt/rco/gct
    standard: Optional[str] = Field(default=None, max_length=64)
    mqt: Optional[str] = Field(default=None, max_length=16)
    status: TestStatus = Field(default=TestStatus.PENDING)
    module_id: Optional[int] = Field(default=None, foreign_key="module.id", index=True)
    operator_id: Optional[int] = Field(default=None, foreign_key="operator.id", index=True)
    equipment_id: Optional[int] = Field(default=None, foreign_key="equipment.id", index=True)
    started_at: Optional[datetime] = Field(default=None, index=True)
    ended_at: Optional[datetime] = None
    params: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    result: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    sample_count: int = Field(default=0)
    created_at: datetime = Field(default_factory=_utcnow, nullable=False)


class TelemetrySample(SQLModel, table=True):
    __tablename__ = "telemetry_sample"

    id: Optional[int] = Field(default=None, primary_key=True)
    test_run_id: int = Field(foreign_key="test_run.id", index=True, nullable=False)
    ts: datetime = Field(default_factory=_utcnow, index=True, nullable=False)
    step_no: Optional[int] = None
    voltage: Optional[float] = None
    current: Optional[float] = None
    power: Optional[float] = None
    temperature: Optional[float] = None
    tags: Optional[dict] = Field(default=None, sa_column=Column(JSON))


class Report(SQLModel, table=True):
    __tablename__ = "report"

    id: Optional[int] = Field(default=None, primary_key=True)
    test_run_id: Optional[int] = Field(default=None, foreign_key="test_run.id", index=True)
    fmt: str = Field(default="pdf", max_length=10)  # pdf / docx
    path: str = Field(max_length=1024)
    sha256: Optional[str] = Field(default=None, max_length=64)
    generated_by: Optional[int] = Field(default=None, foreign_key="operator.id")
    generated_at: datetime = Field(default_factory=_utcnow, nullable=False)


# ---------------------------------------------------------------------------
# Ops / maintenance
# ---------------------------------------------------------------------------
class SparePart(SQLModel, table=True):
    __tablename__ = "spare_part"

    id: Optional[int] = Field(default=None, primary_key=True)
    sku: str = Field(index=True, unique=True, max_length=64)
    name: str = Field(max_length=200)
    description: Optional[str] = None
    qty_on_hand: int = Field(default=0)
    reorder_level: int = Field(default=0)
    location: Optional[str] = Field(default=None, max_length=200)
    created_at: datetime = Field(default_factory=_utcnow, nullable=False)


class MaintenanceTicket(SQLModel, table=True):
    __tablename__ = "maintenance_ticket"

    id: Optional[int] = Field(default=None, primary_key=True)
    equipment_id: Optional[int] = Field(default=None, foreign_key="equipment.id", index=True)
    opened_by: Optional[int] = Field(default=None, foreign_key="operator.id")
    title: str = Field(max_length=200)
    description: Optional[str] = None
    severity: str = Field(default="normal", max_length=16)  # low/normal/high/critical
    status: TicketStatus = Field(default=TicketStatus.OPEN, index=True)
    opened_at: datetime = Field(default_factory=_utcnow, nullable=False)
    closed_at: Optional[datetime] = None


class ComplaintTicket(SQLModel, table=True):
    __tablename__ = "complaint_ticket"

    id: Optional[int] = Field(default=None, primary_key=True)
    module_id: Optional[int] = Field(default=None, foreign_key="module.id", index=True)
    customer_ref: Optional[str] = Field(default=None, max_length=200)
    subject: str = Field(max_length=200)
    description: Optional[str] = None
    status: TicketStatus = Field(default=TicketStatus.OPEN, index=True)
    opened_at: datetime = Field(default_factory=_utcnow, nullable=False)
    closed_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Misc — AI, audit, barcode, schedule
# ---------------------------------------------------------------------------
class AIThread(SQLModel, table=True):
    __tablename__ = "ai_thread"

    id: Optional[int] = Field(default=None, primary_key=True)
    title: str = Field(default="(untitled)", max_length=200)
    operator_id: Optional[int] = Field(default=None, foreign_key="operator.id")
    test_run_id: Optional[int] = Field(default=None, foreign_key="test_run.id", index=True)
    messages: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=_utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=_utcnow, nullable=False)


class AuditLog(SQLModel, table=True):
    __tablename__ = "audit_log"

    id: Optional[int] = Field(default=None, primary_key=True)
    ts: datetime = Field(default_factory=_utcnow, index=True, nullable=False)
    actor: Optional[str] = Field(default=None, max_length=200)
    action: str = Field(max_length=64, index=True)
    entity: Optional[str] = Field(default=None, max_length=64)
    entity_id: Optional[str] = Field(default=None, max_length=64)
    payload: Optional[dict] = Field(default=None, sa_column=Column(JSON))


class BarcodeScan(SQLModel, table=True):
    __tablename__ = "barcode_scan"

    id: Optional[int] = Field(default=None, primary_key=True)
    code: str = Field(index=True, max_length=256)
    kind: Optional[str] = Field(default=None, max_length=32)  # module/spare/equipment
    scanned_by: Optional[int] = Field(default=None, foreign_key="operator.id")
    test_run_id: Optional[int] = Field(default=None, foreign_key="test_run.id", index=True)
    scanned_at: datetime = Field(default_factory=_utcnow, nullable=False)


class Schedule(SQLModel, table=True):
    __tablename__ = "schedule"

    id: Optional[int] = Field(default=None, primary_key=True)
    test_type: str = Field(max_length=20, index=True)
    module_id: Optional[int] = Field(default=None, foreign_key="module.id")
    equipment_id: Optional[int] = Field(default=None, foreign_key="equipment.id")
    operator_id: Optional[int] = Field(default=None, foreign_key="operator.id")
    starts_at: datetime = Field(index=True, nullable=False)
    ends_at: Optional[datetime] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=_utcnow, nullable=False)
