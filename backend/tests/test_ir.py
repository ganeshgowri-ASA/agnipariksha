"""Tests for the forward-bias IR thermography module (IEC TS 60904-12-1):
ROI grid math, hot-spot detection, the uniform / all-hot edge cases, the
annotated-PNG export, the fixture-decode path and the LIVE-mode guard."""
from __future__ import annotations

import io
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app import ir  # noqa: E402


def test_roi_grid_partitions_into_rows_times_cols() -> None:
    grid = ir.roi_grid(192, 384, 6, 12)
    assert len(grid) == 6 * 12
    assert grid[0] == (0, 0, 0, 32, 0, 32)            # row-major, 32×32 cells
    assert grid[-1][:2] == (5, 11)
    assert grid[-1][3] - grid[-1][2] == 32 and grid[-1][5] - grid[-1][4] == 32


def test_roi_grid_drops_remainder_to_keep_cells_equal() -> None:
    grid = ir.roi_grid(200, 100, 6, 4)                # 200//6=33, 100//4=25
    assert {y1 - y0 for _, _, y0, y1, _, _ in grid} == {33}
    assert {x1 - x0 for _, _, _, _, x0, x1 in grid} == {25}


def test_roi_grid_rejects_bad_args() -> None:
    with pytest.raises(ValueError):
        ir.roi_grid(100, 100, 0, 4)
    with pytest.raises(ValueError):
        ir.roi_grid(2, 2, 6, 12)                       # frame too small


def test_synthetic_frame_has_exactly_one_hotspot() -> None:
    res = ir.run_ir(rows=6, cols=12, demo=True, seed=0)
    assert res["hotspot_count"] == 1 and len(res["cells"]) == 6 * 12
    hs = res["hotspots"][0]
    assert (hs["row"], hs["col"]) == (0, 0)
    assert hs["dT"] > res["threshold"] and hs["Tmax"] >= hs["Tmean"]
    assert set(hs) == {"cell_id", "row", "col", "Tmean", "Tmax", "dT", "flagged"}


def test_no_hotspot_on_uniform_frame() -> None:
    cells = ir.analyze(np.full((96, 192), 25.0, np.float32), 6, 12, threshold=10.0)
    assert all(c["dT"] == 0.0 and not c["flagged"] for c in cells)


def test_all_cells_flagged_when_each_has_a_hot_pixel() -> None:
    rows, cols, cp = 4, 4, 16
    frame = np.full((rows * cp, cols * cp), 25.0, np.float32)
    for _, _, y0, _, x0, _ in ir.roi_grid(rows * cp, cols * cp, rows, cols):
        frame[y0, x0] = 100.0                          # one searing pixel per cell
    cells = ir.analyze(frame, rows, cols, threshold=10.0)
    assert len(cells) == rows * cols and all(c["flagged"] for c in cells)


def test_live_mode_is_not_implemented() -> None:
    with pytest.raises(NotImplementedError, match="owner-at-bench"):
        ir.run_ir(demo=False)


def test_annotated_png_is_valid_and_matches_frame() -> None:
    res = ir.run_ir(rows=3, cols=4, demo=True, seed=2)
    png = res["annotated_png"]
    assert isinstance(png, (bytes, bytearray)) and png[:8] == b"\x89PNG\r\n\x1a\n"
    assert Image.open(io.BytesIO(png)).size == (res["frame_shape"][1], res["frame_shape"][0])
    assert res["standard"] == "IEC TS 60904-12-1"


def test_fixture_png_is_decoded_when_present(tmp_path, monkeypatch) -> None:
    fixture = tmp_path / "ir_demo.png"
    Image.fromarray(np.full((64, 128), 200, np.uint8), "L").save(fixture)
    monkeypatch.setattr(ir, "FIXTURE", fixture)
    frame = ir.load_frame(6, 12)
    assert frame.shape == (64, 128)
    assert abs(float(frame.mean()) - (25.0 + 200 / 255 * 60)) < 0.5   # uniform decode
