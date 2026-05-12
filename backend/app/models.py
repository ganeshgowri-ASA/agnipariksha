"""SQLModel entities — Modules, TestRuns and AI threads/messages.

Telemetry is intentionally stored as a denormalised JSON blob on each
``TestRun`` (the production system pushes it to TimescaleDB, but for the
AI assistant we just need a compact in-memory slice). Long fields use
JSON-encoded ``str`` columns so the schema stays portable across SQLite
and Postgres without an ALTER step.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any, Optional

from sqlmodel import Field, SQLModel


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.utcnow()


class Module(SQLModel, table=True):
    __tablename__ = "modules"

    module_id: str = Field(default_factory=_uuid, primary_key=True)
    manufacturer: str
    model: str
    technology: str = "mono-PERC"  # mono-PERC, TOPCon, HJT, bifacial-glass-glass, thin-film
    pmax_stc: float = 0.0
    voc: float = 0.0
    isc: float = 0.0
    vmpp: float = 0.0
    impp: float = 0.0
    bifaciality: float = 0.0  # 0.0 = monofacial, 0..1 otherwise
    area_m2: float = 0.0
    junction_box: str = ""
    bypass_diode_part: str = ""
    datasheet_url: str = ""
    notes: str = ""
    created_at: datetime = Field(default_factory=_now, nullable=False)


class TestRun(SQLModel, table=True):
    __tablename__ = "test_runs"
    __test__ = False  # silence pytest "TestRun looks like a test class" warning

    run_id: str = Field(default_factory=_uuid, primary_key=True)
    module_id: str = Field(foreign_key="modules.module_id", index=True)
    test_type: str = Field(index=True)  # tc | hf | letid | bdt | rco | gct | dh
    iec_clause: str = ""
    params_json: str = "{}"
    started_at: datetime = Field(default_factory=_now, nullable=False)
    ended_at: Optional[datetime] = None
    status: str = "running"  # running | passed | failed | aborted
    raw_csv_path: str = ""
    summary_json: str = "{}"
    telemetry_json: str = "[]"  # compact recent telemetry samples
    pass_fail: Optional[str] = None  # PASS | FAIL | None
    operator: str = ""

    # ---- convenience getters/setters --------------------------------------
    @property
    def params(self) -> dict[str, Any]:
        try:
            return json.loads(self.params_json or "{}")
        except json.JSONDecodeError:
            return {}

    @params.setter
    def params(self, value: dict[str, Any]) -> None:
        self.params_json = json.dumps(value or {})

    @property
    def summary_stats(self) -> dict[str, Any]:
        try:
            return json.loads(self.summary_json or "{}")
        except json.JSONDecodeError:
            return {}

    @summary_stats.setter
    def summary_stats(self, value: dict[str, Any]) -> None:
        self.summary_json = json.dumps(value or {})

    @property
    def telemetry(self) -> list[dict[str, Any]]:
        try:
            return json.loads(self.telemetry_json or "[]")
        except json.JSONDecodeError:
            return []

    @telemetry.setter
    def telemetry(self, value: list[dict[str, Any]]) -> None:
        self.telemetry_json = json.dumps(value or [])


class AIThread(SQLModel, table=True):
    __tablename__ = "ai_threads"

    thread_id: str = Field(default_factory=_uuid, primary_key=True)
    module_id: Optional[str] = Field(default=None, foreign_key="modules.module_id", index=True)
    run_id: Optional[str] = Field(default=None, foreign_key="test_runs.run_id", index=True)
    tab_context: str = ""  # last tab the user looked at
    title: str = "New conversation"
    created_at: datetime = Field(default_factory=_now, nullable=False)
    updated_at: datetime = Field(default_factory=_now, nullable=False)


class AIMessage(SQLModel, table=True):
    __tablename__ = "ai_messages"

    id: Optional[int] = Field(default=None, primary_key=True)
    thread_id: str = Field(foreign_key="ai_threads.thread_id", index=True)
    role: str  # user | assistant | tool
    content: str
    citations_json: str = "[]"  # list of {clause_id, title}
    tool_calls_json: str = "[]"  # list of {name, input, output}
    created_at: datetime = Field(default_factory=_now, nullable=False)

    @property
    def citations(self) -> list[dict[str, Any]]:
        try:
            return json.loads(self.citations_json or "[]")
        except json.JSONDecodeError:
            return []

    @citations.setter
    def citations(self, value: list[dict[str, Any]]) -> None:
        self.citations_json = json.dumps(value or [])

    @property
    def tool_calls(self) -> list[dict[str, Any]]:
        try:
            return json.loads(self.tool_calls_json or "[]")
        except json.JSONDecodeError:
            return []

    @tool_calls.setter
    def tool_calls(self, value: list[dict[str, Any]]) -> None:
        self.tool_calls_json = json.dumps(value or [])
