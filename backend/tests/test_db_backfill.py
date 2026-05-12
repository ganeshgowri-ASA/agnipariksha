"""Tests for the CSV → TestRun backfill (V2-S2)."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

from sqlmodel import Session, select

from backend.db.backfill import _parse_filename, backfill_csv_runs
from backend.db.models import TestRun


def _write_csv(p: Path, rows: int) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    lines = ["ts,V,I,P"]
    lines.extend(f"2026-05-01T12:00:{i:02d},48.0,5.0,240.0" for i in range(rows))
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_parse_filename_known_test_type() -> None:
    ts, kind = _parse_filename("20260501T140312_tc_module-A1")
    assert kind == "tc"
    assert ts == datetime(2026, 5, 1, 14, 3, 12)


def test_parse_filename_unknown_falls_back() -> None:
    ts, kind = _parse_filename("random-blob")
    assert kind == "unknown"
    assert ts is None


def test_backfill_inserts_and_is_idempotent(tmp_path, db_session: Session) -> None:
    runs = tmp_path / "runs"
    _write_csv(runs / "20260501T140312_tc_modA.csv", rows=10)
    _write_csv(runs / "20260502T091000_hf_modB.csv", rows=5)

    inserted = backfill_csv_runs(runs, session=db_session)
    assert inserted == 2

    rows = db_session.exec(select(TestRun).order_by(TestRun.csv_path)).all()
    assert len(rows) == 2
    by_type = {r.test_type: r for r in rows}
    assert set(by_type) == {"tc", "hf"}
    assert by_type["tc"].sample_count == 10
    assert by_type["hf"].sample_count == 5
    # csv_path stored relative to runs_dir.parent
    assert all(r.csv_path and r.csv_path.startswith("runs/") for r in rows)

    # Re-running must NOT duplicate rows.
    again = backfill_csv_runs(runs, session=db_session)
    assert again == 0
    assert len(db_session.exec(select(TestRun)).all()) == 2


def test_backfill_handles_missing_directory(tmp_path, db_session: Session) -> None:
    assert backfill_csv_runs(tmp_path / "does-not-exist", session=db_session) == 0
    assert db_session.exec(select(TestRun)).all() == []


def test_backfill_with_default_session(isolated_db_url, tmp_path) -> None:
    from backend.db.session import get_session, init_db

    init_db(isolated_db_url)
    runs = tmp_path / "runs"
    _write_csv(runs / "20260501T140312_letid.csv", rows=3)

    inserted = backfill_csv_runs(runs, database_url=isolated_db_url)
    assert inserted == 1

    with get_session(isolated_db_url) as s:
        row = s.exec(select(TestRun)).one()
        assert row.test_type == "letid"
        assert row.sample_count == 3
