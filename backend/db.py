"""SQLAlchemy SQLite persistence for Agnipariksha backend.

Auto-creates four tables: sessions, measurements, events, reports.

Schema is intentionally test-agnostic; per-test parameters and results live
in JSON columns so the same DB serves all six IEC test programs.
"""
from __future__ import annotations

import json
import os
import uuid
from contextlib import contextmanager
from datetime import datetime
from typing import Iterator, Optional

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker, Session

DATABASE_URL = os.getenv("AGNI_DB_URL", "sqlite:///./agnipariksha.db")

# check_same_thread=False is required because FastAPI dispatches requests on
# multiple threads while uvicorn runs the asyncio loop on one.
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
Base = declarative_base()


def _uuid() -> str:
    return str(uuid.uuid4())


class TestSession(Base):
    __tablename__ = "sessions"

    id = Column(String, primary_key=True, default=_uuid)
    test_id = Column(String, nullable=False, index=True)   # tc|hf|letid|bdt|rco|gct
    standard = Column(String, nullable=True)               # IEC reference
    module_id = Column(String, nullable=True)
    status = Column(String, default="running", nullable=False)  # running|passed|failed|stopped|aborted
    started_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    ended_at = Column(DateTime, nullable=True)
    params_json = Column(Text, nullable=True)              # serialized dict
    result_json = Column(Text, nullable=True)              # serialized dict (pass/fail + metrics)

    measurements = relationship("Measurement", back_populates="session", cascade="all, delete-orphan")
    events = relationship("Event", back_populates="session", cascade="all, delete-orphan")
    reports = relationship("Report", back_populates="session", cascade="all, delete-orphan")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "test_id": self.test_id,
            "standard": self.standard,
            "module_id": self.module_id,
            "status": self.status,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "ended_at": self.ended_at.isoformat() if self.ended_at else None,
            "params": json.loads(self.params_json) if self.params_json else {},
            "result": json.loads(self.result_json) if self.result_json else None,
        }


class Measurement(Base):
    __tablename__ = "measurements"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String, ForeignKey("sessions.id"), nullable=False, index=True)
    ts = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    v = Column(Float, nullable=True)
    i = Column(Float, nullable=True)
    p = Column(Float, nullable=True)
    step = Column(Integer, nullable=True)
    extra_json = Column(Text, nullable=True)               # temperature, cycle#, etc.

    session = relationship("TestSession", back_populates="measurements")


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String, ForeignKey("sessions.id"), nullable=True, index=True)
    ts = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    kind = Column(String, nullable=False)                  # start|stop|estop|fault|step|info
    message = Column(Text, nullable=True)
    payload_json = Column(Text, nullable=True)

    session = relationship("TestSession", back_populates="events")


class Report(Base):
    __tablename__ = "reports"

    id = Column(String, primary_key=True, default=_uuid)
    session_id = Column(String, ForeignKey("sessions.id"), nullable=False, index=True)
    format = Column(String, nullable=False)                # word|pdf
    filepath = Column(String, nullable=False)
    generated_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    session = relationship("TestSession", back_populates="reports")


def init_db() -> None:
    """Create tables if they don't yet exist. Safe to call repeatedly."""
    Base.metadata.create_all(bind=engine)


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional scope for one-off operations outside FastAPI dependency."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a SQLAlchemy session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ----- Convenience helpers used by the API + WebSocket loop -------------------

def create_session(
    db: Session,
    test_id: str,
    standard: Optional[str] = None,
    module_id: Optional[str] = None,
    params: Optional[dict] = None,
) -> TestSession:
    s = TestSession(
        test_id=test_id,
        standard=standard,
        module_id=module_id,
        params_json=json.dumps(params or {}),
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def finalize_session(
    db: Session,
    session_id: str,
    status: str,
    result: Optional[dict] = None,
) -> Optional[TestSession]:
    s = db.get(TestSession, session_id)
    if not s:
        return None
    s.status = status
    s.ended_at = datetime.utcnow()
    if result is not None:
        s.result_json = json.dumps(result)
    db.commit()
    db.refresh(s)
    return s


def insert_measurement(
    db: Session,
    session_id: str,
    v: float,
    i: float,
    p: float,
    step: int = 0,
    extra: Optional[dict] = None,
) -> None:
    db.add(
        Measurement(
            session_id=session_id,
            v=v,
            i=i,
            p=p,
            step=step,
            extra_json=json.dumps(extra) if extra else None,
        )
    )
    db.commit()


def log_event(
    db: Session,
    kind: str,
    message: str = "",
    session_id: Optional[str] = None,
    payload: Optional[dict] = None,
) -> None:
    db.add(
        Event(
            session_id=session_id,
            kind=kind,
            message=message,
            payload_json=json.dumps(payload) if payload else None,
        )
    )
    db.commit()
