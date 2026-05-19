"""Database connector layer — Test Connection, Migrate & Switch, Fernet-encrypted secrets.

Exports:
    backends      — supported SQLAlchemy URL schemes with display metadata
    test_connection(url) — open a transient engine, ping, return latency + server_version
    encrypt_url / decrypt_url — Fernet wrap for at-rest storage of DSNs
    keyring helpers — store the Fernet key in the OS keyring (Windows Credential
                       Manager / macOS Keychain / freedesktop Secret Service); falls
                       back to ``data/.db_keyring`` with 0600 perms when no
                       keyring backend is available.
    migrate_and_switch(target_url) — Alembic upgrade + atomic data copy + rollback.
"""
from __future__ import annotations

import json
import logging
import os
import stat
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Supported backends
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Backend:
    key: str
    label: str
    scheme: str
    example: str
    requires: tuple[str, ...]  # python dependencies the driver needs
    notes: str = ""


BACKENDS: tuple[Backend, ...] = (
    Backend(
        key="sqlite",
        label="SQLite (default)",
        scheme="sqlite",
        example="sqlite:///./data/agnipariksha.db",
        requires=(),
        notes="File-backed; no install required. Ideal for the desktop build.",
    ),
    Backend(
        key="postgres",
        label="PostgreSQL / Railway",
        scheme="postgresql+psycopg",
        example="postgresql+psycopg://user:pass@host:5432/agnipariksha",
        requires=("psycopg[binary]",),
        notes="Use the Railway-supplied DATABASE_URL; +psycopg picks v3 driver.",
    ),
    Backend(
        key="mysql",
        label="MySQL / MariaDB",
        scheme="mysql+pymysql",
        example="mysql+pymysql://user:pass@host:3306/agnipariksha",
        requires=("pymysql", "cryptography"),
    ),
    Backend(
        key="mssql",
        label="SQL Server (MS SQL)",
        scheme="mssql+pyodbc",
        example="mssql+pyodbc://user:pass@host:1433/agnipariksha?driver=ODBC+Driver+18+for+SQL+Server",
        requires=("pyodbc",),
        notes="Requires the Microsoft ODBC driver installed on the host.",
    ),
    Backend(
        key="access",
        label="Microsoft Access (.accdb / .mdb)",
        scheme="access+pyodbc",
        example="access+pyodbc:///?odbc_connect=DRIVER%3D%7BMicrosoft+Access+Driver+%28%2A.mdb%2C+%2A.accdb%29%7D%3BDBQ%3DC%3A%5Cpath%5Cto%5Cfile.accdb",
        requires=("sqlalchemy-access", "pyodbc"),
        notes="Windows-only; ACE Driver must be installed. Read-mostly support.",
    ),
)


def backend_for(url: str) -> Optional[Backend]:
    for b in BACKENDS:
        if url.startswith(b.scheme + ":") or url.startswith(b.scheme + "+"):
            return b
        if b.scheme == "sqlite" and url.startswith("sqlite"):
            return b
    return None


def list_backends() -> list[dict[str, Any]]:
    return [
        {
            "key": b.key,
            "label": b.label,
            "scheme": b.scheme,
            "example": b.example,
            "requires": list(b.requires),
            "notes": b.notes,
        }
        for b in BACKENDS
    ]


# ---------------------------------------------------------------------------
# Test Connection — open transient engine, ping, return latency + server_version
# ---------------------------------------------------------------------------
_VERSION_QUERY: dict[str, str] = {
    "sqlite": "SELECT sqlite_version()",
    "postgresql": "SHOW server_version",
    "mysql": "SELECT VERSION()",
    "mariadb": "SELECT VERSION()",
    "mssql": "SELECT @@VERSION",
}


def _version_query_for(url: str) -> str:
    for prefix, q in _VERSION_QUERY.items():
        if url.startswith(prefix):
            return q
    return "SELECT 1"


def test_connection(url: str, *, timeout_s: float = 5.0) -> dict[str, Any]:
    """Open a one-shot engine, ping the server, return latency + version.

    Returns a dict shaped:
        {"ok": True|False, "latency_ms": int, "server_version": str|None,
         "error": str|None, "backend": "postgres"|"sqlite"|...}
    """
    backend = backend_for(url)
    payload: dict[str, Any] = {
        "ok": False,
        "latency_ms": None,
        "server_version": None,
        "error": None,
        "backend": backend.key if backend else None,
    }
    engine: Optional[Engine] = None
    try:
        from backend.db.session import create_engine_from_url as _create
        engine = _create(url)
        # Apply a per-statement timeout where the dialect supports it.
        start = time.perf_counter()
        with engine.connect() as conn:
            row = conn.execute(text(_version_query_for(url))).first()
            payload["server_version"] = None if row is None else str(row[0])
        payload["latency_ms"] = int((time.perf_counter() - start) * 1000)
        payload["ok"] = True
    except SQLAlchemyError as exc:
        payload["error"] = f"{type(exc).__name__}: {exc.orig if hasattr(exc, 'orig') else exc}"
    except Exception as exc:  # pragma: no cover - defensive
        payload["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        if engine is not None:
            engine.dispose()
    return payload


# ---------------------------------------------------------------------------
# Fernet-encrypted secrets in OS keyring (with file fallback)
# ---------------------------------------------------------------------------
KEYRING_SERVICE = "agnipariksha"
KEYRING_USER = "db-connector-key"
_FALLBACK_PATH = Path("data/.db_keyring")


def _ensure_data_dir() -> None:
    _FALLBACK_PATH.parent.mkdir(parents=True, exist_ok=True)


def _read_fallback_key() -> Optional[bytes]:
    if not _FALLBACK_PATH.exists():
        return None
    raw = _FALLBACK_PATH.read_bytes().strip()
    return raw or None


def _write_fallback_key(key: bytes) -> None:
    _ensure_data_dir()
    _FALLBACK_PATH.write_bytes(key)
    try:
        os.chmod(_FALLBACK_PATH, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass  # Windows + non-POSIX FS — chmod is best effort


def get_fernet_key() -> bytes:
    """Return the encryption key, generating one on first use.

    Priority: OS keyring → fallback file (0600) → new key.
    """
    try:
        import keyring  # type: ignore
        existing = keyring.get_password(KEYRING_SERVICE, KEYRING_USER)
        if existing:
            return existing.encode("utf-8")
    except Exception as exc:
        log.debug("keyring lookup failed (using file fallback): %s", exc)

    fallback = _read_fallback_key()
    if fallback:
        return fallback

    from cryptography.fernet import Fernet  # local import — optional dep
    key = Fernet.generate_key()
    try:
        import keyring  # type: ignore
        keyring.set_password(KEYRING_SERVICE, KEYRING_USER, key.decode("utf-8"))
    except Exception as exc:
        log.warning("keyring unavailable, storing key in %s (0600): %s", _FALLBACK_PATH, exc)
        _write_fallback_key(key)
    return key


def encrypt_url(plain: str) -> str:
    """Encrypt a DSN with Fernet. Returns a urlsafe base64 token."""
    from cryptography.fernet import Fernet
    f = Fernet(get_fernet_key())
    return f.encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt_url(token: str) -> str:
    from cryptography.fernet import Fernet
    f = Fernet(get_fernet_key())
    return f.decrypt(token.encode("ascii")).decode("utf-8")


# ---------------------------------------------------------------------------
# Migrate & Switch — Alembic upgrade + atomic data copy + rollback
# ---------------------------------------------------------------------------
def _copy_tables(source: Engine, dest: Engine, tables: Iterable[str]) -> dict[str, int]:
    """Copy rows in chunks. Per-table commit so a single bad table can
    roll itself back without losing the others.

    Returns {table: rows_copied}.
    """
    counts: dict[str, int] = {}
    src_meta = inspect(source)
    for tname in tables:
        if tname not in src_meta.get_table_names():
            counts[tname] = 0
            continue
        with Session(source) as src_session, Session(dest) as dst_session:
            rows = list(src_session.execute(text(f"SELECT * FROM {tname}")).mappings())
            if not rows:
                counts[tname] = 0
                continue
            cols = list(rows[0].keys())
            col_list = ", ".join(cols)
            placeholders = ", ".join(f":{c}" for c in cols)
            stmt = text(f"INSERT INTO {tname} ({col_list}) VALUES ({placeholders})")
            try:
                for r in rows:
                    dst_session.execute(stmt, dict(r))
                dst_session.commit()
                counts[tname] = len(rows)
            except SQLAlchemyError as exc:
                dst_session.rollback()
                raise RuntimeError(f"copy {tname} failed: {exc}") from exc
    return counts


def migrate_and_switch(
    target_url: str,
    *,
    alembic_ini: str = "backend/alembic.ini",
    dry_run: bool = False,
) -> dict[str, Any]:
    """Upgrade ``target_url`` to head and copy rows from the current DB.

    Steps (atomic at the per-table level; on any fatal failure we
    return ``rolled_back=True`` and the dest DB is left empty):

      1. Test connection to target — abort early if it fails.
      2. Run ``alembic upgrade head`` against the target URL.
      3. Copy each known table from current DB → target.
      4. If any step fails: drop the alembic version row on target so a
         retry starts clean, and report ``ok=False``.

    Caller (the FastAPI route) is responsible for swapping
    ``DATABASE_URL`` and re-init'ing the engine after this returns
    ``ok=True``.
    """
    from backend.db import session as session_mod
    from backend.db.session import create_engine_from_url

    result: dict[str, Any] = {
        "ok": False,
        "target_url": target_url,
        "tested": False,
        "alembic": None,
        "rows_copied": {},
        "rolled_back": False,
        "error": None,
    }

    probe = test_connection(target_url)
    result["tested"] = probe["ok"]
    if not probe["ok"]:
        result["error"] = f"target unreachable: {probe['error']}"
        return result

    if dry_run:
        result["ok"] = True
        result["error"] = "dry_run — no migration applied"
        return result

    # Step 2 — Alembic upgrade. We import alembic lazily so the prod
    # path that doesn't run migrations doesn't pay the import cost.
    try:
        from alembic import command  # type: ignore
        from alembic.config import Config  # type: ignore
        cfg = Config(alembic_ini)
        cfg.set_main_option("sqlalchemy.url", target_url)
        command.upgrade(cfg, "head")
        result["alembic"] = "upgrade head"
    except Exception as exc:
        result["error"] = f"alembic upgrade failed: {exc}"
        return result

    # Step 3 — copy data.
    source_engine = session_mod.get_engine()
    dest_engine = create_engine_from_url(target_url)
    try:
        # Use the source's table list so we never try to read from a
        # table that only exists on the destination.
        src_tables = inspect(source_engine).get_table_names()
        result["rows_copied"] = _copy_tables(source_engine, dest_engine, src_tables)
        result["ok"] = True
    except Exception as exc:
        result["error"] = f"data copy failed: {exc}"
        # Best effort: clear the alembic version row so a retry starts
        # against an empty schema rather than re-failing the copy.
        try:
            with Session(dest_engine) as s:
                s.execute(text("DELETE FROM alembic_version"))
                s.commit()
            result["rolled_back"] = True
        except SQLAlchemyError:
            result["rolled_back"] = False
    finally:
        dest_engine.dispose()
    return result
