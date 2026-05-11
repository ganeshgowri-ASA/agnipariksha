#!/usr/bin/env bash
# Wrapper: bash backend/start.sh -> bash deploy.sh --no-pull --no-install
# (only restarts the backend without touching deps or git).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

LOG_DIR="$HERE/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/backend.log"
PID_FILE="$LOG_DIR/backend.pid"

PY="${PYTHON:-python}"
command -v "$PY" >/dev/null 2>&1 || PY=python3
command -v "$PY" >/dev/null 2>&1 || PY=py

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null; then
  kill "$(cat "$PID_FILE")" 2>/dev/null || true
  sleep 0.5
fi

cd "$HERE/backend"
nohup "$PY" -m uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}" \
  > "$LOG" 2>&1 < /dev/null &
PID=$!
disown "$PID" 2>/dev/null || true
echo "$PID" > "$PID_FILE"
echo "[start] backend pid $PID  log $LOG"
