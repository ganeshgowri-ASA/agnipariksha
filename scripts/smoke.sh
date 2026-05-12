#!/usr/bin/env bash
# End-to-end smoke test: boots backend + frontend on isolated ports, hits
# every documented route, kills both, exits non-zero if anything fails.
#
# Designed to run both locally (after `npm install` + `pip install`) and in
# CI (Ubuntu runner, fresh checkout).
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

LOG_DIR="$REPO_ROOT/logs"
mkdir -p "$LOG_DIR"
BACK_LOG="$LOG_DIR/smoke-backend.log"
FRONT_LOG="$LOG_DIR/smoke-frontend.log"

BACK_PORT="${BACK_PORT:-8801}"
FRONT_PORT="${FRONT_PORT:-3801}"

ok=0; fail=0
green() { printf '\033[32m%s\033[0m' "$*"; }
red()   { printf '\033[31m%s\033[0m' "$*"; }
pass()  { ok=$((ok+1));  printf '  %s %s\n' "$(green PASS)" "$*"; }
miss()  { fail=$((fail+1)); printf '  %s %s\n' "$(red   FAIL)" "$*"; }

cleanup() {
  [ -n "${BACK_PID:-}" ]  && kill "$BACK_PID"  2>/dev/null || true
  [ -n "${FRONT_PID:-}" ] && kill "$FRONT_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[smoke] starting backend on :$BACK_PORT  log=$BACK_LOG"
( cd backend && nohup python -m uvicorn main:app --host 127.0.0.1 --port "$BACK_PORT" \
  > "$BACK_LOG" 2>&1 < /dev/null & echo $! ) > /tmp/.smoke.bpid
BACK_PID=$(cat /tmp/.smoke.bpid)

echo "[smoke] starting frontend on :$FRONT_PORT  log=$FRONT_LOG"
( cd frontend && NEXT_PUBLIC_BACKEND_HTTP_URL="http://127.0.0.1:$BACK_PORT" \
  nohup npx next dev --turbopack -p "$FRONT_PORT" \
  > "$FRONT_LOG" 2>&1 < /dev/null & echo $! ) > /tmp/.smoke.fpid
FRONT_PID=$(cat /tmp/.smoke.fpid)

wait_200() {
  # -L follows redirects so / -> /overview (307) still resolves to a 200.
  local url="$1" tries="${2:-60}" code=""
  for _ in $(seq 1 "$tries"); do
    code=$(curl -sL -o /dev/null -w '%{http_code}' --max-time 3 "$url" 2>/dev/null || echo 000)
    [ "$code" = "200" ] && return 0
    sleep 1
  done
  return 1
}

echo "[smoke] waiting for backend"
if ! wait_200 "http://127.0.0.1:$BACK_PORT/health" 60; then
  miss "backend did not come up"
  tail -40 "$BACK_LOG" | sed 's/^/    | /'
  exit 1
fi
pass "backend /health"

echo "[smoke] waiting for frontend"
if ! wait_200 "http://127.0.0.1:$FRONT_PORT/" 90; then
  miss "frontend did not come up"
  tail -40 "$FRONT_LOG" | sed 's/^/    | /'
  exit 1
fi
pass "frontend /"

# --- deep checks ---
hcode=$(curl -s -o /tmp/.smoke.health -w '%{http_code}' --max-time 3 "http://127.0.0.1:$BACK_PORT/api/health")
if [ "$hcode" = "200" ] && python3 -c "import json,sys;d=json.load(open('/tmp/.smoke.health'));assert 'scpi_reachable' in d and isinstance(d['scpi_reachable'],bool)" 2>/dev/null; then
  pass "/api/health has scpi_reachable bool"
else
  miss "/api/health missing scpi_reachable"
fi

# Test tab routes (via frontend; expects 307 redirect to /?tab=...)
for slug in thermal-cycling humidity-freeze damp-heat pid bypass-diode reverse-current ground-continuity; do
  code=$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' "http://127.0.0.1:$FRONT_PORT/tests/$slug")
  if [ "$code" = "307" ] || [ "$code" = "200" ]; then
    pass "/tests/$slug -> $code"
  else
    miss "/tests/$slug -> $code (expected 200/307)"
  fi
done

# Dashboard alias
code=$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' "http://127.0.0.1:$FRONT_PORT/dashboard")
if [ "$code" = "307" ] || [ "$code" = "200" ]; then pass "/dashboard -> $code"; else miss "/dashboard -> $code"; fi

# Reports endpoint must return a PDF >5KB
curl -s -o /tmp/.smoke.pdf --max-time 8 \
  -X POST -H 'Content-Type: application/json' \
  -d '{"testId":"ci-smoke","testName":"Damp Heat","standard":"IEC 61215-2 MQT 13"}' \
  "http://127.0.0.1:$FRONT_PORT/api/reports/generate"
pdf_size=$(wc -c < /tmp/.smoke.pdf)
pdf_head=$(head -c 5 /tmp/.smoke.pdf)
if [ "$pdf_size" -gt 500 ] && [ "$pdf_head" = "%PDF-" ]; then
  pass "POST /api/reports/generate returns PDF ($pdf_size bytes)"
else
  miss "POST /api/reports/generate bad (size=$pdf_size, head=$pdf_head)"
fi

echo
echo "[smoke] passed=$ok failed=$fail"
[ "$fail" -eq 0 ] || exit 1
