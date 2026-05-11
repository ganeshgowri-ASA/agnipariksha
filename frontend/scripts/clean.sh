#!/usr/bin/env bash
# Nuke stale Next.js artefacts that cause errors like:
#   Module not found: Can't resolve 'react-server-dom-webpack/server'
#   ENOENT _next/static/...
# (usually means an orphan dev server wrote a half-built .next while
#  node_modules were on a different next version)
#
# Usage:
#   bash frontend/scripts/clean.sh           # wipe + reinstall + build
#   bash frontend/scripts/clean.sh --no-build  # wipe + reinstall only
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

DO_BUILD=1
for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
  esac
done

# Reap anything still bound to :3000 so the swc native binary unlocks
if [ -d node_modules/.bin ]; then
  ./node_modules/.bin/kill-port 3000 >/dev/null 2>&1 || true
fi
if command -v lsof >/dev/null 2>&1; then
  pids=$(lsof -ti tcp:3000 2>/dev/null || true)
  [ -n "${pids:-}" ] && kill -9 $pids 2>/dev/null || true
fi

echo "[clean] removing .next/ node_modules/ package-lock.json"
rm -rf .next node_modules package-lock.json

echo "[clean] npm install (fresh)"
npm install --no-audit --no-fund --loglevel=error

if [ "$DO_BUILD" = 1 ]; then
  echo "[clean] npm run build"
  npm run build
fi

echo "[clean] done. Frontend modules + .next rebuilt."
echo "       Now run: bash deploy.sh --no-install   (or just bash deploy.sh)"
