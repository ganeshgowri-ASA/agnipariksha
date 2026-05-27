"""LeTID orchestrator + checkpoint emitter — IEC TS 63342:2022.

DEMO synthesizes a logistic Pmax(t) decline (~-3% at full duration); LIVE is not
implemented. Each checkpoint hour appends a MARKER (no IV data) to
``tests/letid/<sessionId>/checkpoints.jsonl``; this module imports NO IV code.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

DEFAULT_TEMP_C = 75.0
DEFAULT_DURATION_H = 162.0
DEFAULT_CHECKPOINTS_H: list[float] = [0, 4, 8, 16, 32, 64, 96, 128, 162]
PASS_RATIO = 0.95  # PASS iff Pmax(end)/Pmax(0) >= 0.95
CHECKPOINT_ROOT = Path("tests/letid")
_DEMO_FLOOR = -0.03  # fractional Pmax change at full duration
_DEMO_STEEPNESS = 8.0


def degradation(t_hours: float, duration_h: float = DEFAULT_DURATION_H) -> float:
    """Fractional DEMO Pmax change: logistic, 0 at t=0 and -3% at t=duration."""
    if duration_h <= 0 or t_hours <= 0:
        return 0.0
    u = min(t_hours / duration_h, 1.0)
    sig = lambda x: 1.0 / (1.0 + math.exp(-_DEMO_STEEPNESS * (x - 0.5)))
    return _DEMO_FLOOR * (sig(u) - sig(0.0)) / (sig(1.0) - sig(0.0))


def synth_pmax(t_hours: float, pmax_initial: float,
               duration_h: float = DEFAULT_DURATION_H) -> float:
    """DEMO Pmax(t) = Pmax_initial * (1 + degradation(t))."""
    return pmax_initial * (1.0 + degradation(t_hours, duration_h))


def verdict(pmax_initial: float, pmax_final: float,
            pass_ratio: float = PASS_RATIO) -> dict[str, Any]:
    """PASS iff Pmax_final / Pmax_initial >= pass_ratio (IEC TS 63342)."""
    if pmax_initial <= 0:
        return {"verdict": "FAIL", "ratio": 0.0, "pass_ratio": pass_ratio}
    ratio = pmax_final / pmax_initial
    return {"verdict": "PASS" if ratio >= pass_ratio else "FAIL",
            "ratio": round(ratio, 6), "pass_ratio": pass_ratio}


@dataclass
class LetidSession:
    """One LeTID soak. ``root`` is overridable so tests stay off the repo tree."""
    session_id: str
    injection_current_a: float
    pmax_initial: float = 100.0
    temp_c: float = DEFAULT_TEMP_C
    duration_h: float = DEFAULT_DURATION_H
    checkpoints_h: list[float] = field(default_factory=lambda: list(DEFAULT_CHECKPOINTS_H))
    demo: bool = True
    root: Path = CHECKPOINT_ROOT

    def checkpoint_path(self) -> Path:
        return Path(self.root) / self.session_id / "checkpoints.jsonl"


def _emitted_hours(path: Path) -> set[float]:
    """Checkpoint hours already recorded in ``path`` (empty if absent)."""
    done: set[float] = set()
    if not path.exists():
        return done
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "letid_checkpoint" and "t_hours" in event:
            done.add(float(event["t_hours"]))
    return done


def run_demo(session: LetidSession) -> list[dict[str, Any]]:
    """Append a marker per not-yet-emitted checkpoint; return the new ones.

    Resumable + idempotent: already-present hours are skipped, so re-running an
    interrupted session only appends the missing markers.
    """
    if not session.demo:
        raise NotImplementedError(
            "LIVE LeTID requires chamber + injection PSU + owner-at-bench")
    path = session.checkpoint_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    already = _emitted_hours(path)
    fresh: list[dict[str, Any]] = []
    with path.open("a", encoding="utf-8") as handle:
        for raw in session.checkpoints_h:
            t = float(raw)
            if t in already:
                continue
            event = {"type": "letid_checkpoint", "session_id": session.session_id,
                     "t_hours": t, "marker_id": f"{session.session_id}@{t:g}h"}
            handle.write(json.dumps(event) + "\n")
            fresh.append(event)
            already.add(t)
    return fresh
