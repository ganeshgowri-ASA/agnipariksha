#!/usr/bin/env bash
# Agnipariksha one-click local deploy.
#
#   bash deploy.sh             # pull, install, restart, smoke-test
#   bash deploy.sh --no-pull   # skip git pull (e.g. on a feature branch)
#   bash deploy.sh --no-install # skip pip / npm install
#
# Logs:  ~/agnipariksha/logs/{backend,frontend}.log
# Pids:  ~/agnipariksha/logs/{backend,frontend}.pid
#
# Stops anything bound to :8000 and :3000 first, so reruns are safe.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

LOG_DIR="$REPO_ROOT/logs"
mkdir -p "$LOG_DIR"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
BACKEND_PID_FILE="$LOG_DIR/backend.pid"
FRONTEND_PID_FILE="$LOG_DIR/frontend.pid"

DO_PULL=1
DO_INSTALL=1
for arg in "$@"; do
  case "$arg" in
    --no-pull)    DO_PULL=0 ;;
    --no-install) DO_INSTALL=0 ;;
    -h|--help)
      sed -n '2,12p' "${BASH_SOURCE[0]}"; exit 0 ;;
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

# --- pick python ---
PY=""
for cand in python python3 py; do
  if command -v "$cand" >/dev/null 2>&1; then PY="$cand"; break; fi
done
if [ -z "$PY" ]; then err "no python interpreter on PATH"; exit 1; fi

kill_port() {
  local port="$1" pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  elif command -v fuser >/dev/null 2>&1; then
    pids=$(fuser -n tcp "$port" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' || true)
  fi
  if [ -n "${pids:-}" ]; then
    say "killing processes on :$port -> $pids"
    kill -9 $pids 2>/dev/null || true
    sleep 0.3
  fi
  # Cross-platform belt: kill-port is bundled in frontend devDeps.
  if [ -d "$REPO_ROOT/frontend/node_modules/.bin" ]; then
    "$REPO_ROOT/frontend/node_modules/.bin/kill-port" "$port" >/dev/null 2>&1 || true
  fi
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
  # -L follows redirects: / now goes 307 -> /overview, which is 200.
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
hr

# 1. git pull
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

# 2. stop anything on the ports
say "freeing ports :8000 (backend) and :3000 (frontend)"
stop_recorded_pid "$BACKEND_PID_FILE"  backend
stop_recorded_pid "$FRONTEND_PID_FILE" frontend
kill_port 8000
kill_port 3000

# 3. backend deps
if [ "$DO_INSTALL" = 1 ]; then
  say "pip install -r backend/requirements.txt"
  ( cd backend && "$PY" -m pip install --quiet --disable-pip-version-check -r requirements.txt ) \
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

# 4. start backend (fully detach: < /dev/null + disown so the parent
#    script returns the prompt to the user instead of blocking on wait)
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

# 5. start frontend
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

# 6. health checks
hr
say "waiting up to 30s for backend /health"
HEALTH_BODY=""
if HCODE=$(wait_http_200 http://127.0.0.1:8000/health 30); then
  HEALTH_BODY=$(curl -s --max-time 2 http://127.0.0.1:8000/health || echo '{}')
  ok "backend  → 200  $HEALTH_BODY"
else
  err "backend  → $HCODE  (see $BACKEND_LOG)"
  tail -n 20 "$BACKEND_LOG" 2>/dev/null | sed 's/^/    | /'
fi

say "waiting up to 60s for frontend /"
if FCODE=$(wait_http_200 http://127.0.0.1:3000/ 60); then
  ok "frontend → 200"
else
  err "frontend → $FCODE  (see $FRONTEND_LOG)"
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
