# feat/db-connectors — scope

Branch base: c2993a1 (post-PR #29). Will need rebase on PR #32 + any
intervening main-merges.

## Spec (verbatim)

`/settings/database` page with driver picker:
1. **SQLite** (default, bundled, `backend/data/agnipariksha.db`) — already live on main via PR #27.
2. **MS Access** via `pyodbc` + Access ODBC driver. User provides `.mdb` / `.accdb` path; auto-create schema.
3. **SQL Server / PostgreSQL / MySQL** via SQLAlchemy URL — user pastes `postgresql://...`, `mssql+pyodbc://...`, `mysql+pymysql://...`.
4. **Railway cloud** — user pastes Railway-provided Postgres URL; validate with `SELECT 1` and run Alembic migrations.

## Endpoints
- `POST /api/db/test` — Test Connection: latency_ms + server_version.
- `POST /api/db/migrate` — Alembic `upgrade head` against the new URL, **atomic data copy**, flip active connection, rollback on any failure.
- `GET  /api/db/current` — `{driver, host_or_path, server_version, last_migration}`.

## Secrets
- Connection strings encrypted at rest with Fernet.
- Master key in OS keyring (Windows Credential Manager on desktop build via `keyring` package).
- Stored at `backend/data/secrets.enc`.

## Schema-import follow-up
Migrate everything from solarlabx-vendored modules + the 24-sheet ISO 17025 / IEC 61215 / 61730 / 61853 / 62804 / 63342 schema attached to the parent session.

## Tests
- pytest: roundtrip insert -> migrate (SQLite -> in-memory Postgres via testcontainers) -> verify row count + checksum.
- Negative path: forced migration failure -> confirm automatic rollback restores the old active connection.

## Verification
- bash deploy.sh GREEN, /api/db/current returns {driver:sqlite, ...} by default.
- /settings/database swaps driver and Test Connection returns < 2 s on a sane URL.
- Switching back to SQLite preserves all tickets/equipment/spares rows.

## Open follow-ups for an attached session
1. backend/db/session.py + backend/db/backfill.py from PR #27 are the integration points.
2. backend/alembic/ already exists. render_as_batch in env.py already handles SQLite ALTERs.
3. Choose Fernet key derivation: PBKDF2(machine-id, salt). Document the rotation procedure.
