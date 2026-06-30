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
echo "All MATLAB model parity checks passed."
