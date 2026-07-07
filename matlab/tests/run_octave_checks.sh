#!/usr/bin/env bash
# Verify the MATLAB/Simulink DC-PSU model against the Python reference trace
# headlessly with GNU Octave — no MATLAB license required. Runs the same .m
# files MATLAB would, and fails (non-zero exit) on any divergence.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

run() {
  echo "== $1 =="
  octave-cli -q --eval "cd '$here'; ok = $1(); exit(double(~ok))"
}

run plant_parity_check
run simulink_plant_parity
run console_logic_check

# Third engine (optional): if Scilab is installed, cross-check the plant
# there too. Skipped silently when absent so CI stays Octave-only.
if command -v scilab-cli >/dev/null 2>&1; then
  echo "== scilab_plant_parity =="
  scilab-cli -nb -f "$here/scilab_plant_parity.sce"
fi
echo "All MATLAB model parity checks passed."
