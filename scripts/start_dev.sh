#!/usr/bin/env bash
# Agnipariksha — start backend + frontend concurrently (Git Bash / macOS / Linux)
# Usage:  bash scripts/start_dev.sh
#
# - Verifies prerequisites (node, npm, python/py)
# - Installs dependencies on first run
# - Launches backend (FastAPI) and frontend (Next dev) in parallel
# - Tears both down on Ctrl-C

set -euo pipefail

REPO_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
BACKEND_DIR="${REPO_ROOT}/backend"
FRONTEND_DIR="${REPO_ROOT}/frontend"

log() { printf '\033[1;36m[start_dev]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[start_dev]\033[0m %s\n' "$*" >&2; }

# --- Resolve python launcher -------------------------------------------------
if command -v python >/dev/null 2>&1; then
  PY=python
elif command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v py >/dev/null 2>&1; then
  PY=py
else
  err "Python not found on PATH. Install Python 3.11+ and reopen the shell."
  exit 1
fi

# --- Verify node / npm -------------------------------------------------------
if ! command -v npm >/dev/null 2>&1; then
  err "npm not found. Install Node.js LTS from https://nodejs.org/ and reopen the shell."
  exit 1
fi

# --- Install deps (idempotent) ----------------------------------------------
log "Installing backend deps…"
( cd "${BACKEND_DIR}" && "${PY}" -m pip install --quiet -r requirements.txt )

if [ ! -d "${FRONTEND_DIR}/node_modules" ]; then
  log "Installing frontend deps (first run)…"
  ( cd "${FRONTEND_DIR}" && npm install )
fi

if [ ! -f "${FRONTEND_DIR}/.env.local" ] && [ -f "${REPO_ROOT}/.env.example" ]; then
  log "Seeding frontend/.env.local from .env.example"
  cp "${REPO_ROOT}/.env.example" "${FRONTEND_DIR}/.env.local"
fi

# --- Launch ------------------------------------------------------------------
PIDS=()
cleanup() {
  log "Shutting down…"
  for pid in "${PIDS[@]:-}"; do
    if [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

log "Starting backend on :8000"
( cd "${BACKEND_DIR}" && "${PY}" main.py ) &
PIDS+=("$!")

log "Starting frontend on :3000"
( cd "${FRONTEND_DIR}" && npm run dev ) &
PIDS+=("$!")

log "Both processes started.  Backend pid=${PIDS[0]}  Frontend pid=${PIDS[1]}"
log "Open http://localhost:3000  —  press Ctrl-C to stop."

# Wait for either process to exit, then teardown
wait -n
exit $?
