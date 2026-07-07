"""Guard the committed reference trace the MATLAB plant model cross-checks.

If the Python DemoPsuSource model changes, this fails until
``matlab/reference_trace.csv`` is regenerated (python -m backend.app.psu_trace),
keeping the MATLAB/Simulink model and the Python sim in lock-step.
"""
from __future__ import annotations

import csv
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.psu_trace import (  # noqa: E402
    ON_TICKS,
    TRACE_HEADER,
    TRACE_TICKS,
    default_csv_path,
    reference_trace,
)


def _read_csv():
    with default_csv_path().open(newline="") as f:
        reader = csv.reader(f)
        header = tuple(next(reader))
        rows = [tuple(float(x) for x in row) for row in reader]
    return header, rows


def test_committed_csv_matches_python_model() -> None:
    header, rows = _read_csv()
    assert header == TRACE_HEADER
    gen = reference_trace()
    assert len(rows) == len(gen) == TRACE_TICKS
    for csv_row, g in zip(rows, gen):
        assert int(csv_row[0]) == g[0]
        for csv_val, gen_val in zip(csv_row[1:], g[1:]):
            assert csv_val == pytest.approx(gen_val, abs=1e-9)


def test_trace_shows_heatup_then_cooldown() -> None:
    rows = reference_trace()
    peak_temp = rows[ON_TICKS - 1][4]  # last ON tick
    end_temp = rows[-1][4]  # last OFF tick
    assert peak_temp > 25.0  # heated under load
    assert end_temp < peak_temp  # cooled after output OFF
    # Voltage tracks up under load and decays after OFF.
    assert rows[ON_TICKS - 1][1] == pytest.approx(48.0, abs=0.5)
    assert rows[-1][1] == pytest.approx(0.0, abs=0.5)
