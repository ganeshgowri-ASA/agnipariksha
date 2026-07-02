# Agnipariksha — MATLAB App Designer Console

A MATLAB **App Designer** reproduction of the Agnipariksha web console, wired
to the same FastAPI backend over REST. Runs as a desktop app and packages for
**MATLAB Web App Server** (browser-hosted) or as a standalone `.mlappinstall`.
Source-only — MATLAB App Designer/Compiler can't run in this repo's Linux
CI — but `console_logic.m` and `psu_rest.m` are UI-free and have been
**executed for real**, including a live HTTP round-trip against a running
backend (see "Verified execution" below).

## Files

| File | What it is | Needs |
|------|------------|-------|
| `AgniparikshaConsole.m` | App Designer code-behind (classdef): header (mode + backend-health lamps, Base URL), **PSU Console** tab (V/I/P/Tj gauges, setpoint spinners + Output switch + Write), **Overview** tab (KPI tiles + equipment table). Polls the backend every second; Write is disabled live until the setpoint validates. | base MATLAB (R2021a+) |
| `console_logic.m` | Pure (UI-free) console logic — gauge clamping, mode color, setpoint validation — dispatched by name. Executed headlessly in `tests/console_logic_check.m`. | base MATLAB / Octave |
| `psu_rest.m` | REST client (`get` / `get_safe` / `set` / `health`) using `webread`/`webwrite`. Normalises MATLAB-vs-Octave JSON handling. Shared by the App Designer console and the Simulink live-interface block. | base MATLAB |
| `build_webapp.m` | Packages the app into a Web App archive (`.ctf`) for MATLAB Web App Server. | MATLAB Compiler |
| `package_app.m` | Packages the app as a standalone `.mlappinstall` desktop installer. **Unverified scaffold** — `matlab.apputil` has no Octave equivalent at all, so this one script could not be executed anywhere in this environment; cross-check property names against your release. | MATLAB (App Packaging) |

## What it mirrors

| Web console | This app |
|-------------|----------|
| `/dashboard` PSU control + DEMO/LIVE toggle | **PSU Console** tab: live gauges, setpoint form, mode lamp |
| `/overview` KPI + equipment-health cards | **Overview** tab: KPI tiles + equipment table |
| Backend `GET /api/opcua/psu`, `POST /api/opcua/psu/setpoints`, `GET /health` | `psu_rest.m` |

## Run locally

```matlab
% 1. Start the backend (DEMO):  uvicorn backend.main:app --port 8000
% 2. In MATLAB, from this folder:
addpath(pwd);
app = AgniparikshaConsole;     % opens the console, polls :8000
```

Edit the **Base URL** field in the header to point at a remote backend.

## Deploy to MATLAB Web App Server

```matlab
build_webapp;                  % -> ./webapp_build/AgniparikshaConsole.ctf
```

Then copy the `.ctf` into the Web App Server apps directory (e.g.
`C:\MATLAB\webapps\apps`) or upload it from the server home page. The hosted
app reaches the backend via the **Base URL** field — make sure uvicorn `:8000`
is reachable from the Web App Server machine (and CORS allows it; the backend
already allows `:3000`/`:1420` — add the Web App Server origin if needed).

## Deploy as a standalone desktop app

```matlab
package_app;                   % -> ./app_build/AgniparikshaConsole.mlappinstall
```

Double-click the `.mlappinstall` (or `matlab.apputil.install(...)`) to add it
to another user's Apps gallery. See the caveat on `package_app.m` above —
this one script is unverified since `matlab.apputil` cannot run outside
MATLAB.

## Verified execution (no MATLAB license needed)

`console_logic.m` and `psu_rest.m` are UI-free by design (mirroring
`frontend/features/opcua/psuClient.ts` on the web side), so unlike
`AgniparikshaConsole.m` itself they run under GNU Octave. Both were executed
for real in this repo's environment:

```
tests/console_logic_check.m   -> 13/13 assertions passed (clamping, mode
                                  color, setpoint bounds — same [0,1000] V /
                                  [0,100] A limits as the backend + web app)
```

`psu_rest.m` was executed **against a live backend** (`uvicorn` started in
DEMO mode): `health`, `get`, and `get_safe` round-tripped correctly —
including `get_safe` returning `[]` without throwing against an unreachable
port. `set`'s exact JSON payload (`jsonencode` output) was independently
POSTed to the same live backend and accepted (`HTTP 200`), with the DEMO
simulator visibly converging toward the commanded 48 V / 2 A. The one thing
that could *not* be driven through Octave is Octave's own `webwrite`
transport for `set` — confirmed from its source
(`/usr/share/octave/*/m/web/webwrite.m`) to only implement
`application/x-www-form-urlencoded` bodies, never JSON — a structural Octave
limitation, not a MATLAB one; `set` uses the standard MathWorks-documented
JSON-POST idiom and is correct MATLAB code.

## Backend service topology (from the deploy runbook)

| Service | Port | Notes |
|---------|------|-------|
| `agnipariksha-backend` (uvicorn) | `8000` | `AGNI_MODE=DEMO`, `PSU_DRIVER=demo`, `DEMO_MODE=true`; health at `/health` |
| `agnipariksha-frontend` (next start) | `3000` | the web console this app mirrors |
| `agnipariksha-psu-demo` (simulator) | `5025` | **NEVER live** — DEMO PSU only |

## Safety

The Output switch + Write button only POST a setpoint to the backend. In DEMO
mode that drives the simulator. **LIVE PSU energization stays gated server-side**
(owner-at-bench + E-stop; `LivePsuSource.allow_energize`) — this console never
bypasses that. The live ITECH PV6000 at `192.168.200.100:30000` stays
read-only until the hardware bring-up checklist is signed off.
