"""Section registry for Report Engine v2.

Defines the canonical IDs for every selectable block in a report along with
their human-readable labels. PDF and DOCX builders both consume this registry
so they stay in lock-step.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


ALL_SECTIONS: tuple[str, ...] = (
    "header",
    "test_description",
    "iec_clause",
    "parameters",
    "graphs",
    "tables",
    "pass_fail",
    "raw_data_path",
    "error_log",
    "troubleshooting",
    "signature",
    "photos",
)

SECTION_LABELS: dict[str, str] = {
    "header": "Header",
    "test_description": "Test Description",
    "iec_clause": "IEC Clause",
    "parameters": "Parameters",
    "graphs": "Graphs",
    "tables": "Tables",
    "pass_fail": "Pass / Fail",
    "raw_data_path": "Raw Data Path",
    "error_log": "Error Log",
    "troubleshooting": "Troubleshooting",
    "signature": "Signature",
    "photos": "Photos",
}

ALL_GRAPHS: tuple[str, ...] = (
    "voltage",
    "current",
    "power",
    "temperature",
    "rh",
    "tj",
    "vf_vs_t",
)

GRAPH_LABELS: dict[str, str] = {
    "voltage": "Voltage (V) vs time",
    "current": "Current (A) vs time",
    "power": "Power (W) vs time",
    "temperature": "Temperature (°C) vs time",
    "rh": "Relative Humidity (%) vs time",
    "tj": "Junction Temperature (°C) vs time",
    "vf_vs_t": "Forward Voltage (V) vs Temperature (°C)",
}

ALL_TABLES: tuple[str, ...] = ("raw", "decimated", "summary")

TABLE_LABELS: dict[str, str] = {
    "raw": "Raw readings",
    "decimated": "Decimated readings",
    "summary": "Statistical summary",
}


class Reading(BaseModel):
    """One telemetry sample. All optional except timestamp."""
    timestamp: float
    voltage: Optional[float] = None
    current: Optional[float] = None
    power: Optional[float] = None
    temperature: Optional[float] = None
    rh: Optional[float] = None
    tj: Optional[float] = None
    vf: Optional[float] = None


class ReportRequest(BaseModel):
    """V2 request body for POST /api/reports/generate.

    Backwards-compatible aliases (testId, testName) keep older callers working.
    """
    run_id: str = Field(default="", alias="run_id")
    test_id: Optional[str] = Field(default=None, alias="testId")
    test_name: Optional[str] = Field(default=None, alias="testName")
    standard: Optional[str] = None
    iec_clause: Optional[str] = None
    operator: Optional[str] = None
    module_id: Optional[str] = Field(default=None, alias="moduleId")
    lab_name: Optional[str] = None
    notes: Optional[str] = None
    raw_data_path: Optional[str] = None
    result: Optional[str] = None  # "PASS" / "FAIL" / "IN PROGRESS"

    pre_max_power: Optional[float] = None
    post_max_power: Optional[float] = None
    delta_pmax_percent: Optional[float] = None
    threshold_percent: Optional[float] = None

    sections: Optional[list[str]] = None
    graphs: Optional[list[str]] = None
    tables: Optional[list[str]] = None
    format: str = "pdf"

    readings: list[Reading] = Field(default_factory=list)
    error_log: list[str] = Field(default_factory=list)
    troubleshooting: list[str] = Field(default_factory=list)
    photos: list[str] = Field(default_factory=list)  # base64 PNGs

    qr_base_url: str = ""

    model_config = {"populate_by_name": True, "extra": "ignore"}

    @property
    def effective_run_id(self) -> str:
        return self.run_id or self.test_id or "run"

    @property
    def effective_test_name(self) -> str:
        return self.test_name or "PV Module Test"


def normalize_sections(
    requested: Optional[list[str]],
    universe: tuple[str, ...],
) -> list[str]:
    """Filter to the known IDs, preserving registry order. None ⇒ all."""
    if requested is None:
        return list(universe)
    want = {s for s in requested}
    return [s for s in universe if s in want]
