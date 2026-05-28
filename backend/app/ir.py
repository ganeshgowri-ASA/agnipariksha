"""Forward-Bias Infrared Thermography (IR) — IEC TS 60904-12-1.

DEMO pipeline: capture a thermogram (fixture PNG if present, else a synthetic
ambient frame with one Gaussian hot-spot), auto-grid into ``rows × cols`` cell
ROIs, and flag cells whose spread ``dT = Tmax − Tmean`` exceeds the threshold.
LIVE is unsupported — it needs a calibrated camera, bias PSU and an operator.
"""
from __future__ import annotations

import io
import os
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "ir_demo.png"
DEMO_MODE = os.getenv("IR_DEMO_MODE", "1").lower() not in {"0", "false", "no"}

DEFAULT_THRESHOLD_C = 10.0
DEFAULT_CELL_PX = 32
_AMBIENT_C = 25.0       # uniform forward-bias plateau
_NOISE_C = 0.4          # per-pixel sensor noise (1σ)
_HOTSPOT_C = 55.0       # peak rise of the synthetic defect
_FIXTURE_SPAN_C = 60.0  # grayscale→°C span when decoding an 8-bit fixture


def roi_grid(height: int, width: int, rows: int, cols: int) -> list[tuple[int, int, int, int, int, int]]:
    """Auto-grid a frame into equal ``rows × cols`` cell ROIs, row-major
    ``(row, col, y0, y1, x0, x1)``; remainder pixels are dropped so ROIs match."""
    if rows < 1 or cols < 1:
        raise ValueError("rows and cols must be >= 1")
    ch, cw = height // rows, width // cols
    if ch < 1 or cw < 1:
        raise ValueError("frame too small for the requested grid")
    return [(r, c, r * ch, r * ch + ch, c * cw, c * cw + cw)
            for r in range(rows) for c in range(cols)]


def analyze(frame: np.ndarray, rows: int, cols: int, threshold: float = DEFAULT_THRESHOLD_C) -> list[dict[str, Any]]:
    """Per-cell hot-spot table rows: cell_id, row, col, Tmean, Tmax, dT, flagged."""
    h, w = frame.shape
    table: list[dict[str, Any]] = []
    for r, c, y0, y1, x0, x1 in roi_grid(h, w, rows, cols):
        roi = frame[y0:y1, x0:x1]
        tmean, tmax = float(roi.mean()), float(roi.max())
        dt = tmax - tmean
        table.append({"cell_id": r * cols + c, "row": r, "col": c,
                      "Tmean": round(tmean, 2), "Tmax": round(tmax, 2),
                      "dT": round(dt, 2), "flagged": dt > threshold})
    return table


def synthesize_frame(rows: int, cols: int, *, cell_px: int = DEFAULT_CELL_PX, seed: int = 0) -> np.ndarray:
    """Reproducible ambient thermogram with a single tight Gaussian hot-spot,
    centred in one deterministic cell so demo analysis yields exactly one flag."""
    rng = np.random.default_rng(seed)
    h, w = rows * cell_px, cols * cell_px
    frame = _AMBIENT_C + rng.normal(0.0, _NOISE_C, size=(h, w))
    cy = (seed % rows) * cell_px + cell_px / 2
    cx = ((seed // rows) % cols) * cell_px + cell_px / 2
    ys, xs = np.ogrid[:h, :w]
    sigma = cell_px / 5.0
    frame += _HOTSPOT_C * np.exp(-(((ys - cy) ** 2 + (xs - cx) ** 2) / (2 * sigma * sigma)))
    return frame.astype(np.float32)


def load_frame(rows: int, cols: int, *, cell_px: int = DEFAULT_CELL_PX, seed: int = 0) -> np.ndarray:
    """DEMO frame: decode the fixture PNG to °C if present, else synthesize."""
    if FIXTURE.exists():
        gray = np.asarray(Image.open(FIXTURE).convert("L"), dtype=np.float32)
        return _AMBIENT_C + (gray / 255.0) * _FIXTURE_SPAN_C
    return synthesize_frame(rows, cols, cell_px=cell_px, seed=seed)


def annotate(frame: np.ndarray, table: list[dict[str, Any]], rows: int, cols: int) -> bytes:
    """PNG export: normalized thermogram + ROI grid, flagged cells boxed red."""
    lo, hi = float(frame.min()), float(frame.max())
    norm = (frame - lo) / (hi - lo) if hi > lo else np.zeros_like(frame)
    img = Image.fromarray((norm * 255).astype(np.uint8), "L").convert("RGB")
    draw = ImageDraw.Draw(img)
    for cell, (r, c, y0, y1, x0, x1) in zip(table, roi_grid(*frame.shape, rows, cols)):
        draw.rectangle([x0, y0, x1 - 1, y1 - 1], outline=(64, 64, 64))
        if cell["flagged"]:
            draw.rectangle([x0, y0, x1 - 1, y1 - 1], outline=(255, 0, 0), width=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def run_ir(rows: int = 6, cols: int = 12, *, threshold: float = DEFAULT_THRESHOLD_C,
           demo: bool = DEMO_MODE, cell_px: int = DEFAULT_CELL_PX, seed: int = 0) -> dict[str, Any]:
    """Full DEMO IR pipeline: capture → ROI analysis → annotated PNG. LIVE is
    unsupported by design and raises ``NotImplementedError``."""
    if not demo:
        raise NotImplementedError(
            "LIVE IR requires calibrated thermal camera + bias PSU + owner-at-bench")
    frame = load_frame(rows, cols, cell_px=cell_px, seed=seed)
    table = analyze(frame, rows, cols, threshold)
    hotspots = [c for c in table if c["flagged"]]
    return {"standard": "IEC TS 60904-12-1", "rows": rows, "cols": cols,
            "threshold": threshold, "frame_shape": [int(frame.shape[0]), int(frame.shape[1])],
            "cells": table, "hotspots": hotspots, "hotspot_count": len(hotspots),
            "annotated_png": annotate(frame, table, rows, cols)}
