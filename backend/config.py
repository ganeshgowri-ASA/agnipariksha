"""Centralised settings for the Agnipariksha backend.

Loaded from environment variables (or .env in the backend dir).
"""
from __future__ import annotations

from functools import lru_cache
from typing import List

try:
    from pydantic_settings import BaseSettings, SettingsConfigDict
    _HAS_PSETTINGS = True
except ImportError:  # pragma: no cover - fallback for minimal envs
    from pydantic import BaseModel as BaseSettings  # type: ignore[assignment]
    SettingsConfigDict = dict  # type: ignore[assignment]
    _HAS_PSETTINGS = False


class Settings(BaseSettings):
    """Runtime configuration.

    Reads `.env` from the backend working directory by default.
    """

    APP_NAME: str = "Agnipariksha Backend"
    APP_VERSION: str = "1.1.0"

    # Hardware
    ITECH_IP: str = "192.168.200.100"
    ITECH_PORT: int = 30000
    # First-connect on multi-homed Windows hosts (Wi-Fi + lab Ethernet) can
    # take ~1 s while the OS picks the right route — 500 ms was too tight
    # and caused spurious scpi_reachable=false on the user's lab box.
    ITECH_TIMEOUT_MS: int = 1500
    # Connect-retry budget. Env-tunable so a lab box on a flaky cable can
    # raise it without code change; the per-attempt timeout is ITECH_TIMEOUT_MS.
    ITECH_RETRY_ATTEMPTS: int = 4

    DEMO_MODE: bool = True

    # Logging
    LOG_LEVEL: str = "INFO"
    LOG_DIR: str = "logs"

    # CORS — comma-separated list
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:1420"

    # --- Persistence (V2-S2) ---
    # SQLite default at <cwd>/data/agnipariksha.db. Postgres optional via
    # DATABASE_URL=postgresql+psycopg://user:pw@host:5432/dbname.
    DATABASE_URL: str = "sqlite:///./data/agnipariksha.db"
    # Directory scanned by the startup backfill for historical CSV runs.
    CSV_RUNS_DIR: str = "data/runs"
    # Disable the startup backfill (e.g. during tests) by setting false.
    DB_BACKFILL_ON_STARTUP: bool = True

    if _HAS_PSETTINGS:
        model_config = SettingsConfigDict(  # type: ignore[misc]
            env_file=".env",
            env_file_encoding="utf-8",
            case_sensitive=True,
            extra="ignore",
        )

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
