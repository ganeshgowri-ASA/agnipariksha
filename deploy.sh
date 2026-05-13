#!/usr/bin/env bash
# Agnipariksha one-click local deploy (Windows-resilient via Git Bash / WSL).
#
#   bash deploy.sh             # pull, install, restart, smoke-test
#   bash deploy.sh --no-pull   # skip git pull (e.g. on a feature branch)
#   bash deploy.sh --no-install # skip pip / npm install
#   bash deploy.sh --clean     # wipe .next + node_modules/.cache before start
#
# Logs:  /tmp/agnipariksha-{backend,frontend}.log
# Pids:  /tmp/agnipariksha-{backend,frontend}.pid
#
# Frees :3000 and :8000 first via `npx kill-port`, so reruns are safe on
# Windows (where lsof/fuser are missing under Git Bash). Prefers python3
# over python — on stock Windows, `python` is the App-Execution-Alias
# stub that prints "Python was not found" and exits 9009.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

LOG_DIR="${TMPDIR:-/tmp}"
mkdir -p "$LOG_DIR"
BACKEND_LOG="$LOG_DIR/agnipariksha-backend.log"
FRONTEND_LOG="$LOG_DIR/agnipariksha-frontend.log"
BACKEND_PID_FILE="$LOG_DIR/agnipariksha-backend.pid"
FRONTEND_PID_FILE="$LOG_DIR/agnipariksha-frontend.pid"

DO_PULL=1
DO_INSTALL=1
DO_CLEAN=0
for arg in "$@"; do
  case "$arg" in
    --no-pull)    DO_PULL=0 ;;
    --no-install) DO_INSTALL=0 ;;
    --clean)      DO_CLEAN=1 ;;
    -h|--help)
      sed -n '2,15p' "${BASH_SOURCE[0]}"; exit 0 ;;
  esac
done

c_red()   { printf '\033[31m%s\033[0m' "$*"; }
c_grn()   { printf '\033[32m%s\033[0m' "$*"; }
c_yel()   { printf '\033[33m%s\033[0m' "$*"; }
c_dim()   { printf '\033[2m%s\033[0m' "$*"; }
hr()      { printf '%s\n' '────────────────────────────────────────────────────'; }
say()     { printf '%s %s\n' "$(c_dim "[deploy]")" "$*"; }
ok()      { printf '  %s %s\n' "$(c_grn '✓')" "$*"; }
warn()    { printf '  %s %s\n' "$(c_yel '!')" "$*"; }
err()     { printf '  %s %s\n' "$(c_red '✗')" "$*"; }

# --- pick python (prefer python3 — `python` on Windows is the App-Execution-
#     Alias stub that prints "Python was not found" and exits 9009). ---
PY=""
for cand in python3 py python; do
  if command -v "$cand" >/dev/null 2>&1; then
    if "$cand" -c 'import sys; sys.exit(0)' >/dev/null 2>&1; then
      PY="$cand"; break
    fi
  fi
done
if [ -z "$PY" ]; then err "no working python interpreter on PATH (tried python3, py, python)"; exit 1; fi
say "python interpreter: $PY ($("$PY" --version 2>&1))"

# --- kill-port via npx (cross-platform; falls back to native tools) ---
free_ports() {
  local ports=("$@")
  if command -v npx >/dev/null 2>&1; then
    say "npx kill-port ${ports[*]}"
    npx --yes kill-port "${ports[@]}" >/dev/null 2>&1 || true
  fi
  # Belt + braces: also try the Unix-native path so reruns are clean even
  # if npx is unavailable.
  for port in "${ports[@]}"; do
    local pids=""
    if command -v lsof >/dev/null 2>&1; then
      pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
    elif command -v fuser >/dev/null 2>&1; then
      pids=$(fuser -n tcp "$port" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' || true)
    fi
    if [ -n "${pids:-}" ]; then
      say "killing leftover pids on :$port -> $pids"
      kill -9 $pids 2>/dev/null || true
    fi
  done
}

stop_recorded_pid() {
  local file="$1" name="$2"
  if [ -f "$file" ]; then
    local pid; pid=$(cat "$file" 2>/dev/null || true)
    if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
      say "stopping previous $name (pid $pid)"
      kill "$pid" 2>/dev/null || true
      sleep 0.5
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$file"
  fi
}

wait_http_200() {
  local url="$1" tries="${2:-30}" code=""
  for _ in $(seq 1 "$tries"); do
    code=$(curl -sL -o /dev/null -w '%{http_code}' --max-time 3 "$url" 2>/dev/null || echo 000)
    if [ "$code" = "200" ]; then echo "$code"; return 0; fi
    sleep 1
  done
  echo "${code:-000}"
  return 1
}

hr
say "Agnipariksha one-click deploy"
say "repo root: $REPO_ROOT"
say "log dir:   $LOG_DIR"
hr

# 1. git pull (only on main)
if [ "$DO_PULL" = 1 ]; then
  say "git fetch + fast-forward main"
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    branch=$(git rev-parse --abbrev-ref HEAD)
    git fetch origin --quiet || warn "git fetch failed"
    if [ "$branch" = "main" ]; then
      git pull --ff-only --quiet && ok "main fast-forwarded" || warn "git pull skipped"
    else
      warn "on branch '$branch' (not main); skipping pull"
    fi
  else
    warn "not a git repo; skipping pull"
  fi
else
  say "skipping git pull (--no-pull)"
fi

# 2. free :3000 and :8000 (npx kill-port first)
free_ports 3000 8000
stop_recorded_pid "$BACKEND_PID_FILE"  backend
stop_recorded_pid "$FRONTEND_PID_FILE" frontend

# 3. optional --clean wipe
if [ "$DO_CLEAN" = 1 ]; then
  say "--clean: wiping .next and node_modules/.cache"
  rm -rf "$REPO_ROOT/frontend/.next" 2>/dev/null || true
  rm -rf "$REPO_ROOT/frontend/node_modules/.cache" 2>/dev/null || true
  ok "build caches cleared"
fi

# 4. deps
if [ "$DO_INSTALL" = 1 ]; then
  say "pip install -q -r backend/requirements.txt"
  "$PY" -m pip install -q -r backend/requirements.txt \
    && ok "backend deps installed" \
    || { err "pip install failed; see output above"; exit 1; }

  if [ -d frontend ]; then
    say "npm install (frontend)"
    ( cd frontend && npm install --no-audit --no-fund --loglevel=error ) \
      && ok "frontend deps installed" \
      || { err "npm install failed"; exit 1; }
  fi
else
  say "skipping installs (--no-install)"
fi

# 5. start backend (fully detached)
say "starting backend → $BACKEND_LOG"
pushd backend >/dev/null
nohup "$PY" -m uvicorn main:app --host 0.0.0.0 --port 8000 \
  > "$BACKEND_LOG" 2>&1 < /dev/null &
BPID=$!
disown "$BPID" 2>/dev/null || true
popd >/dev/null
echo "$BPID" > "$BACKEND_PID_FILE"
sleep 0.5
ok "backend pid $BPID"

# 6. start frontend
say "starting frontend → $FRONTEND_LOG"
pushd frontend >/dev/null
nohup npm run dev:noclean \
  > "$FRONTEND_LOG" 2>&1 < /dev/null &
FPID=$!
disown "$FPID" 2>/dev/null || true
popd >/dev/null
echo "$FPID" > "$FRONTEND_PID_FILE"
sleep 0.5
ok "frontend pid $FPID"

# 7. health checks
hr
say "waiting up to 30s for backend /health"
HEALTH_BODY=""
if HCODE=$(wait_http_200 http://127.0.0.1:8000/health 30); then
  HEALTH_BODY=$(curl -s --max-time 2 http://127.0.0.1:8000/health || echo '{}')
  ok "backend  /health     → 200  $HEALTH_BODY"
else
  err "backend  /health     → $HCODE  (see $BACKEND_LOG)"
  tail -n 20 "$BACKEND_LOG" 2>/dev/null | sed 's/^/    | /'
fi

# Deep health probe — same /api/health the React UI uses.
DCODE=$(curl -sL -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8000/api/health 2>/dev/null || echo 000)
if [ "$DCODE" = "200" ]; then
  ok "backend  /api/health → 200"
else
  warn "backend  /api/health → $DCODE"
fi

# Frontend: Next dev start-up is slow under Turbopack on first hit. Give
# it a 12 s warm-up, then poll explicitly with `npx wait-on` (works on
# Windows where curl-loop semantics drift between Git Bash builds).
# Fall back to the bash curl loop if wait-on is unavailable.
say "warming frontend (sleep 12) then waiting for :3000"
sleep 12
FCODE="000"
if command -v npx >/dev/null 2>&1; then
  if npx --yes wait-on -t 30000 http://127.0.0.1:3000 >/dev/null 2>&1; then
    FCODE=$(curl -sL -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/ 2>/dev/null || echo 000)
  else
    FCODE="000"
  fi
fi
if [ "$FCODE" != "200" ]; then
  if FCODE=$(wait_http_200 http://127.0.0.1:3000/ 60); then :; fi
fi
if [ "$FCODE" = "200" ]; then
  ok "frontend /            → 200"
else
  err "frontend /            → $FCODE  (see $FRONTEND_LOG)"
  tail -n 20 "$FRONTEND_LOG" 2>/dev/null | sed 's/^/    | /'
fi

hr
if [ "${HCODE:-000}" = "200" ] && [ "${FCODE:-000}" = "200" ]; then
  printf '%s  Agnipariksha is up.\n'   "$(c_grn 'PASS')"
  printf '       backend  pid %s   log %s\n' "$BPID" "$BACKEND_LOG"
  printf '       frontend pid %s   log %s\n' "$FPID" "$FRONTEND_LOG"
  printf '       open  http://localhost:3000\n'
  exit 0
else
  printf '%s  one or more services did not return 200.\n' "$(c_red 'FAIL')"
  printf '       backend  pid %s   log %s\n' "$BPID" "$BACKEND_LOG"
  printf '       frontend pid %s   log %s\n' "$FPID" "$FRONTEND_LOG"
  exit 1
fi
