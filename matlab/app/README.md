# Agnipariksha — MATLAB App Designer Console

A MATLAB **App Designer** reproduction of the Agnipariksha web console, wired
to the same FastAPI backend over REST. Runs as a desktop app and packages for
**MATLAB Web App Server** (browser-hosted). Source-only — MATLAB can't run in
this repo's Linux CI, so these files are for your MATLAB install.

## Files

| File | What it is | Needs |
|------|------------|-------|
| `AgniparikshaConsole.m` | App Designer code-behind (classdef): header (mode + backend-health lamps, Base URL), **PSU Console** tab (V/I/P/Tj gauges, setpoint spinners + Output switch + Write), **Overview** tab (KPI tiles + equipment table). Polls the backend every second. | base MATLAB (R2021a+) |
| `psu_rest.m` | Minimal REST client (`get` / `set` / `health`) using `webread`/`webwrite`. Shared by the app and deployable to Web App Server. | base MATLAB |
| `build_webapp.m` | Packages the app into a Web App archive (`.ctf`). | MATLAB Compiler |

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
