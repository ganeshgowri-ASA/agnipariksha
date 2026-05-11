#!/usr/bin/env bash
# Run Next dev on :3000, killing any orphan listener first.
#
# Usage:
#   bash frontend/scripts/dev.sh
#   PORT=3001 bash frontend/scripts/dev.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

PORT="${PORT:-3000}"

echo "[agnipariksha] clearing any process bound to :${PORT}"
# kill-port is in devDependencies; npx resolves locally first.
npx --yes kill-port "$PORT" >/dev/null 2>&1 || true

# Belt-and-braces for stray UNIX listeners (Git Bash on Windows uses kill-port).
if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -ti tcp:"$PORT" 2>/dev/null || true)
  if [ -n "${PIDS:-}" ]; then
    echo "[agnipariksha] killing lingering pids: $PIDS"
    kill -9 $PIDS 2>/dev/null || true
  fi
fi

echo "[agnipariksha] starting next dev on :${PORT}"
exec npx next dev --turbopack -p "$PORT"
