# feat/pv6000-scpi-control — scope

Branch base: c2993a1 (post-PR #29). Will need rebase on top of PR #32 once it merges.

## Spec (verbatim from session directive)

- ITECH PV6000 SCPI driver per the IT9000-PV6000 manual + `src-tauri/binaries/device.xml`.
- TCP socket to `192.168.200.100:30000`, behind `HARDWARE_MODE=live|demo` env.
- Commands: `*IDN?`, `SYST:ERR?`, `MEAS:VOLT?/CURR?/POW?`, `SOUR:VOLT/CURR`, `OUTP ON/OFF`.
- Per-test programs: Thermal Cycling, Humidity Freeze, LeTID, Bypass Diode, Reverse Current Overload, Ground Continuity, Damp Heat — per IEC 61215-2:2021, IEC 61730-2, IEC TS 63342, IEC 62804.

## Endpoints
- `GET  /api/hardware/health` → `{mode, connected, idn, last_error}`
- `GET/POST/PATCH/DELETE /api/supplies` — CRUD up to 20 slots; transports `tcp|usb|gpib|rs232|can`.
- `POST /api/supplies/:id/test` → `{ok, idn, rtt_ms, error}`
- `POST /api/supplies/scan` — probe `192.168.200.0/24:30000`.
- `WS /ws/telemetry` — 5 Hz V/I/P/T per supply; simulator fallback in demo (20 virtual supplies w/ randomised IDNs).

## Frontend
- `/settings/power-supplies` — 20-slot rack grid. Per-card: Test Connection (RTT + IDN), Enable/Disable, Remove.
- Bulk: Subnet Scan, CSV import/export.
- "Target Supplies" multi-select on every IEC test tab → run in parallel across N racks.
- Header DEMO→LIVE badge flips automatically when `HARDWARE_MODE=live` AND socket reachable.
- Per Setup tab: "Connection" card (ping, IDN, errors, reconnect button).

## Safety (non-negotiable)
- E-STOP global: broadcasts `OUTP OFF` + `SYST:LOCAL` to every connected supply, synchronously, no retries.
- 2-second hardware watchdog cuts output if no telemetry heartbeat received.
- All output-changing commands gated behind explicit operator confirmation when in LIVE mode.

## Tests
- pytest with mocked socket for CI.
- `scripts/hw-acceptance.sh` — on-site 60-second low-power live handshake against `192.168.200.100`.

## Verification (after rebase + gate)
- `pytest -q` green including new transport+driver tests.
- `bash deploy.sh` ends GREEN; `/api/hardware/health` returns `{mode:'demo', connected:false}` on dev box.
- `/ws/telemetry?supply_id=…` opens, emits ≥5 frames/s simulated data.
- Manual: `scripts/hw-acceptance.sh` on a host reachable to 192.168.200.100 returns IDN and 60s of clean reads.

## Open follow-ups for an attached session
1. Read `backend/scpi_driver.py` + `backend/scpi_async.py` — extend, don't rewrite.
2. Treat `backend/app/transports/` (from PR #26) as the abstraction layer for new transports.
3. Reuse `backend/app/devices/*.yaml` registry for the 20-slot defaults.
4. Use the existing `ScpiClient` for the simulator path; subclass for live.
