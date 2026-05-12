"""Alembic environment.

Reads DATABASE_URL from the environment (falling back to ``alembic.ini``),
sets up SQLModel.metadata as the target, and supports both online and
offline migration modes.
"""
from __future__ import annotations

import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# Make the ``backend`` package importable when alembic is invoked from
# either the repo root or backend/.
HERE = Path(__file__).resolve().parent
BACKEND_DIR = HERE.parent
REPO_ROOT = BACKEND_DIR.parent
for p in (str(REPO_ROOT), str(BACKEND_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

# Import models so SQLModel.metadata is populated for autogenerate.
try:
    from backend.db import models  # noqa: F401
    from sqlmodel import SQLModel
except ImportError:  # running from inside backend/
    from db import models  # type: ignore[no-redef]  # noqa: F401
    from sqlmodel import SQLModel


config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Env var wins over alembic.ini so deploys can flip to Postgres without
# touching the file.
db_url = os.environ.get("DATABASE_URL")
if db_url:
    config.set_main_option("sqlalchemy.url", db_url)

target_metadata = SQLModel.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=url.startswith("sqlite") if url else False,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        is_sqlite = connection.dialect.name == "sqlite"
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=is_sqlite,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
