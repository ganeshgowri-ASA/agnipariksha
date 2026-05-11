#!/usr/bin/env bash
# Wrapper that just starts the frontend dev server in the background.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

LOG_DIR="$HERE/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/frontend.log"
PID_FILE="$LOG_DIR/frontend.pid"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null; then
  kill "$(cat "$PID_FILE")" 2>/dev/null || true
  sleep 0.5
fi

if [ -d "$HERE/frontend/node_modules/.bin" ]; then
  "$HERE/frontend/node_modules/.bin/kill-port" 3000 >/dev/null 2>&1 || true
fi

cd "$HERE/frontend"
nohup npm run dev:noclean > "$LOG" 2>&1 < /dev/null &
PID=$!
disown "$PID" 2>/dev/null || true
echo "$PID" > "$PID_FILE"
echo "[start] frontend pid $PID  log $LOG"
