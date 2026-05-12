#!/usr/bin/env bash
# Nightly DB backup (V2-S2).
#
# - SQLite: hot-copy via `sqlite3 .backup` (atomic, safe under concurrent writes).
# - Postgres: pg_dump to compressed custom format.
#
# Selection: reads DATABASE_URL from the environment (or backend/.env if
# present). Defaults to sqlite:///./data/agnipariksha.db.
#
# Output: backups/agnipariksha-YYYYmmddTHHMMSS.{db,dump}
# Retention: keeps the last $BACKUP_KEEP files (default 14).
#
# Cron example (host crontab):
#   0 2 * * *  /opt/agnipariksha/scripts/backup_db.sh >> /var/log/agni-backup.log 2>&1
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
cd "$REPO_ROOT"

# Load backend/.env if it exists so DATABASE_URL is picked up.
if [[ -f backend/.env && -z "${DATABASE_URL:-}" ]]; then
  # shellcheck disable=SC2046
  set -a; . backend/.env; set +a
fi

DATABASE_URL="${DATABASE_URL:-sqlite:///./data/agnipariksha.db}"
BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
TS="$(date -u +%Y%m%dT%H%M%S)"

mkdir -p "$BACKUP_DIR"

case "$DATABASE_URL" in
  sqlite:*)
    # Strip the sqlite:/// prefix.
    raw="${DATABASE_URL#sqlite:///}"
    case "$raw" in
      /*) src="$raw" ;;        # absolute (sqlite:////abs/path)
       *) src="$REPO_ROOT/$raw" ;;  # relative (sqlite:///./data/...)
    esac
    if [[ ! -f "$src" ]]; then
      echo "[backup] no sqlite file at $src — nothing to back up." >&2
      exit 0
    fi
    out="$BACKUP_DIR/agnipariksha-${TS}.db"
    if command -v sqlite3 >/dev/null 2>&1; then
      sqlite3 "$src" ".backup '$out'"
    else
      # Fallback: plain cp. Safe iff the writer is quiesced.
      cp -- "$src" "$out"
    fi
    echo "[backup] sqlite -> $out"
    ;;
  postgres*|postgresql*)
    out="$BACKUP_DIR/agnipariksha-${TS}.dump"
    pg_dump --format=custom --no-owner --no-privileges --file="$out" "$DATABASE_URL"
    echo "[backup] postgres -> $out"
    ;;
  *)
    echo "[backup] unsupported DATABASE_URL scheme: $DATABASE_URL" >&2
    exit 1
    ;;
esac

# Retention: prune oldest, keep $BACKUP_KEEP newest.
mapfile -t files < <(ls -1t "$BACKUP_DIR"/agnipariksha-*.{db,dump} 2>/dev/null || true)
if (( ${#files[@]} > BACKUP_KEEP )); then
  for old in "${files[@]:BACKUP_KEEP}"; do
    rm -f -- "$old"
    echo "[backup] pruned $old"
  done
fi
