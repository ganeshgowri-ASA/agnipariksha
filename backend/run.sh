#!/usr/bin/env bash
# Run Agnipariksha FastAPI backend on http://0.0.0.0:8000
#
# Usage:
#   bash backend/run.sh
#   bash backend/run.sh --reload          # auto-reload on edits
#   PORT=8080 bash backend/run.sh         # custom port
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

PY="${PYTHON:-python}"
if ! command -v "$PY" >/dev/null 2>&1; then
  if command -v py >/dev/null 2>&1; then PY=py; else PY=python3; fi
fi

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
EXTRA=()
for arg in "$@"; do
  case "$arg" in
    --reload) EXTRA+=("--reload") ;;
    *)        EXTRA+=("$arg") ;;
  esac
done

echo "[agnipariksha] starting uvicorn main:app on ${HOST}:${PORT}"
exec "$PY" -m uvicorn main:app --host "$HOST" --port "$PORT" "${EXTRA[@]}"
