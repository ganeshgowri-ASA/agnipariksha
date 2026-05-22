#!/usr/bin/env bash
# preflight-bench.sh — READ-ONLY check of the ITECH PV6000 PSU.
# SAFETY: NEVER energizes the PSU. Query-only SCPI. Refuses to proceed
# if OUTP? returns 1. Does NOT issue OUTP ON, VOLT, or CURR set commands.
set -euo pipefail

ITECH_IP="${ITECH_IP:-192.168.200.100}"
ITECH_PORT="${ITECH_PORT:-30000}"
NC_TIMEOUT="${NC_TIMEOUT:-2}"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
log()   { printf '[preflight-bench] %s\n' "$*"; }

scpi() {
    # READ-ONLY: refuse anything that could energize the supply.
    local q="$1"
    case "$q" in
        *ON*|VOLT\ *|CURR\ *)
            red "REFUSED to send non-query SCPI: ${q}"; exit 1 ;;
    esac
    printf '%s\n' "$q" \
        | nc -q"${NC_TIMEOUT}" "${ITECH_IP}" "${ITECH_PORT}" || true
}

log "Target: ${ITECH_IP}:${ITECH_PORT}"

# (a) TCP reachability
if ! nc -zv -w"${NC_TIMEOUT}" "${ITECH_IP}" "${ITECH_PORT}" 2>&1; then
    red "TCP unreachable: ${ITECH_IP}:${ITECH_PORT}"; exit 1
fi

# (b) Identification
IDN="$(scpi '*IDN?')"
log "*IDN? -> ${IDN:-<no reply>}"
if ! printf '%s' "${IDN}" | grep -qi 'itech'; then
    red "Unexpected *IDN? reply (expected ITECH): ${IDN}"; exit 1
fi

# (c) Output state — refuse to proceed if energized
OUTP="$(scpi 'OUTP?' | tr -d '[:space:]')"
log "OUTP? -> ${OUTP:-<no reply>}"
if [ "${OUTP}" = "1" ]; then
    red "############################################################"
    red "# DANGER: PV6000 OUTPUT IS ON (OUTP?=1).                    #"
    red "# Refusing to proceed. Disable output manually and retry.   #"
    red "############################################################"
    exit 1
fi
if [ "${OUTP}" != "0" ]; then
    red "OUTP? reply not '0' (got '${OUTP}'). Aborting."; exit 1
fi

# (d) Measure (read-only)
VOLT="$(scpi 'MEAS:VOLT?' | tr -d '\r')"
CURR="$(scpi 'MEAS:CURR?' | tr -d '\r')"
log "MEAS:VOLT? -> ${VOLT:-<no reply>}"
log "MEAS:CURR? -> ${CURR:-<no reply>}"

green "Preflight OK: OUTP=0, ITECH identified, V/I logged."
