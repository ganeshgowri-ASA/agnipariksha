"""Database connector layer — connectors, encrypted secret store, FastAPI router."""

from .connectors import (
    BACKENDS,
    Backend,
    backend_for,
    decrypt_url,
    encrypt_url,
    get_fernet_key,
    list_backends,
    migrate_and_switch,
    test_connection,
)
from .store import (
    DatabaseSettings,
    load_settings,
    save_settings,
)

__all__ = [
    "BACKENDS",
    "Backend",
    "DatabaseSettings",
    "backend_for",
    "decrypt_url",
    "encrypt_url",
    "get_fernet_key",
    "list_backends",
    "load_settings",
    "migrate_and_switch",
    "save_settings",
    "test_connection",
]
