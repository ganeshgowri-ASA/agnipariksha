"""Canonical DC-PSU step-response trace.

Shared ground truth for the Python ``DemoPsuSource`` and the MATLAB/Simulink
plant model (``matlab/``). Both reproduce this 60-tick scenario — 30 ticks
commanding 48 V / 2 A output-ON, then 30 ticks OFF — and are cross-checked
against the committed ``matlab/reference_trace.csv``, so the two
implementations cannot silently drift apart.
"""
from __future__ import annotations

import csv
from pathlib import Path
from typing import List, Tuple

from .opcua_bridge import DemoPsuSource
from .opcua_server import PsuSetpoints

TRACE_HEADER = ("tick", "voltage_v", "current_a", "power_w", "temperature_c")
TRACE_TICKS = 60
ON_TICKS = 30
ON_SETPOINT = (48.0, 2.0)

Row = Tuple[int, float, float, float, float]


def reference_trace() -> List[Row]:
    """Run the canonical scenario through the Python plant and return rows."""
    src = DemoPsuSource()
    rows: List[Row] = []
    for tick in range(TRACE_TICKS):
        on = tick < ON_TICKS
        src.apply(
            PsuSetpoints(
                voltage_v=ON_SETPOINT[0] if on else 0.0,
                current_a=ON_SETPOINT[1] if on else 0.0,
                output_enabled=on,
            )
        )
        r = src.read()
        rows.append((tick, r.voltage_v, r.current_a, r.power_w, r.temperature_c))
    return rows


def default_csv_path() -> Path:
    return Path(__file__).resolve().parents[2] / "matlab" / "reference_trace.csv"


def write_csv(path: Path | None = None) -> Path:
    path = path or default_csv_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(TRACE_HEADER)
        w.writerows(reference_trace())
    return path


if __name__ == "__main__":
    print(f"wrote {write_csv()}")
