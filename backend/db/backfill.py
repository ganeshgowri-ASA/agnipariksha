"""CSV → TestRun backfill.

CSV remains the source of truth for telemetry. On startup we scan
``CSV_RUNS_DIR`` and mirror any new files into ``test_run`` rows so the
dashboard, reports, and ops UI can query them. The job is idempotent: an
existing ``test_run.csv_path`` row is left untouched (the column has a
UNIQUE index).

Expected CSV filename convention (best-effort parsing — unknown shapes
still get a row, just with ``test_type="unknown"``)::

    <YYYYmmddTHHMMSS>_<test_type>[_<extra>].csv
    e.g. 20260501T140312_tc_module-A1.csv

The header row of the file determines ``sample_count`` (line count minus
the header). Anything that can't be opened is logged and skipped.
"""
from __future__ import annotations

import csv
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Iterable, Optional

from sqlmodel import Session, select

from .models import TestRun, TestStatus
from .session import get_session

log = logging.getLogger(__name__)

_KNOWN_TEST_TYPES = {"tc", "hf", "letid", "bdt", "rco", "gct"}

# 20260501T140312, 2026-05-01T14:03:12, 2026-05-01_14-03-12
_TS_PATTERNS = (
    "%Y%m%dT%H%M%S",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d_%H-%M-%S",
    "%Y%m%d_%H%M%S",
)


def _parse_filename(stem: str) -> tuple[Optional[datetime], str]:
    """Return (started_at, test_type) parsed from a CSV stem.

    Falls back to (None, "unknown") if no portion of the name parses.
    """
    parts = re.split(r"[._\-]", stem, maxsplit=2)
    started_at: Optional[datetime] = None
    test_type = "unknown"

    if parts:
        # The first or first-two tokens often carry the timestamp.
        candidates = [parts[0]]
        if len(parts) >= 2:
            candidates.append(f"{parts[0]}_{parts[1]}")
        for cand in candidates:
            for fmt in _TS_PATTERNS:
                try:
                    started_at = datetime.strptime(cand, fmt)
                    break
                except ValueError:
                    continue
            if started_at is not None:
                break

    for token in parts:
        tl = token.lower()
        if tl in _KNOWN_TEST_TYPES:
            test_type = tl
            break

    return started_at, test_type


def _count_samples(path: Path) -> int:
    try:
        with path.open("r", encoding="utf-8", errors="replace", newline="") as fh:
            reader = csv.reader(fh)
            # Skip header if present.
            try:
                next(reader)
            except StopIteration:
                return 0
            return sum(1 for _ in reader)
    except OSError as exc:
        log.warning("backfill: cannot read %s: %s", path, exc)
        return 0


def _relpath(path: Path, root: Path) -> str:
    try:
        return str(path.resolve().relative_to(root.resolve()))
    except ValueError:
        return str(path.resolve())


def iter_csv_files(runs_dir: Path) -> Iterable[Path]:
    if not runs_dir.exists():
        return []
    return sorted(p for p in runs_dir.rglob("*.csv") if p.is_file())


def backfill_csv_runs(
    runs_dir: str | Path,
    *,
    session: Optional[Session] = None,
    database_url: Optional[str] = None,
) -> int:
    """Mirror CSV files into ``test_run``. Returns rows inserted.

    Idempotent: ``csv_path`` is unique, so re-running is a no-op for files
    already imported. ``session`` is optional — when omitted, a transient
    session against the configured engine is used.
    """
    runs_path = Path(runs_dir)
    root = runs_path.parent if runs_path.exists() else runs_path

    def _do(sess: Session) -> int:
        inserted = 0
        for csv_file in iter_csv_files(runs_path):
            rel = _relpath(csv_file, root)
            existing = sess.exec(
                select(TestRun).where(TestRun.csv_path == rel)
            ).first()
            if existing is not None:
                continue
            started_at, test_type = _parse_filename(csv_file.stem)
            run = TestRun(
                csv_path=rel,
                test_type=test_type,
                status=TestStatus.PASSED,  # historical runs are complete by assumption
                started_at=started_at,
                sample_count=_count_samples(csv_file),
            )
            sess.add(run)
            inserted += 1
        if inserted:
            sess.commit()
        return inserted

    if session is not None:
        return _do(session)
    with get_session(database_url) as sess:
        return _do(sess)
