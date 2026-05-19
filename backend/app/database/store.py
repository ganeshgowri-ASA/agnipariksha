"""Persistent store for the user-selected database configuration.

The active DSN is held in two places:

  * `os.environ["DATABASE_URL"]` (process-local, what SQLAlchemy reads)
  * `data/db_settings.json` (persistent across restarts; the URL is
    Fernet-encrypted, only the backend key + display label are plain)

This module owns the JSON; the FastAPI router owns the env swap.
"""
from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

from .connectors import decrypt_url, encrypt_url

log = logging.getLogger(__name__)

SETTINGS_PATH = Path("data/db_settings.json")


@dataclass
class DatabaseSettings:
    backend: str = "sqlite"              # key from BACKENDS
    label: str = "Local SQLite"
    encrypted_url: str = ""              # Fernet-encrypted SQLAlchemy URL
    updated_at: str = ""
    last_test: dict = field(default_factory=dict)  # last test_connection result

    def url(self) -> Optional[str]:
        if not self.encrypted_url:
            return None
        try:
            return decrypt_url(self.encrypted_url)
        except Exception as exc:
            log.error("failed to decrypt DSN — falling back to default: %s", exc)
            return None


def load_settings() -> DatabaseSettings:
    if not SETTINGS_PATH.exists():
        return DatabaseSettings()
    try:
        raw = json.loads(SETTINGS_PATH.read_text())
    except (json.JSONDecodeError, OSError) as exc:
        log.warning("db_settings.json unreadable, using defaults: %s", exc)
        return DatabaseSettings()
    return DatabaseSettings(
        backend=raw.get("backend", "sqlite"),
        label=raw.get("label", "Local SQLite"),
        encrypted_url=raw.get("encrypted_url", ""),
        updated_at=raw.get("updated_at", ""),
        last_test=raw.get("last_test", {}),
    )


def save_settings(
    *,
    backend: str,
    label: str,
    plain_url: str,
    last_test: Optional[dict] = None,
) -> DatabaseSettings:
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    s = DatabaseSettings(
        backend=backend,
        label=label,
        encrypted_url=encrypt_url(plain_url),
        updated_at=datetime.utcnow().isoformat(timespec="seconds") + "Z",
        last_test=last_test or {},
    )
    SETTINGS_PATH.write_text(json.dumps(asdict(s), indent=2))
    return s
