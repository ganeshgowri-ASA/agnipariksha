# Agnipariksha (अग्निपरीक्षा)

### PV Module Reliability Test Station

> *Agnipariksha* — Sanskrit for "Trial by Fire" — the ultimate test of resilience.

A full-stack web + desktop application for programming the **ITECH PV6000 DC Power Supply** to perform 6 IEC-standard PV module reliability tests.

---

## Table of Contents
1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [Test Suite](#test-suite)
4. [Prerequisites](#prerequisites)
5. [Quick Start — Git Bash (Windows / macOS / Linux)](#quick-start--git-bash-windows--macos--linux)
6. [Quick Start — PowerShell (Windows)](#quick-start--powershell-windows)
7. [Troubleshooting](#troubleshooting)
8. [Verify ITECH Device Reachability](#verify-itech-device-reachability)
9. [Project Structure](#project-structure)
10. [Go-Live Checklist](#go-live-checklist)

---

## Project Overview

Agnipariksha drives an **ITECH PV6000 Series** DC source over raw TCP SCPI to execute six IEC reliability tests on PV modules. The frontend (Next.js 15 + React 19) ships as a web app and a Tauri 2 desktop binary. The backend (FastAPI) streams live V / I / P / R telemetry to the UI over a WebSocket and exposes a thin REST surface for device control. A Claude-powered MCP layer adds anomaly detection, compliance Q&A and natural-language SCPI synthesis.

---

## Architecture

```
                    ┌────────────────────────────────────────────────┐
                    │                  Operator                      │
                    └───────────────┬────────────────────────────────┘
                                    │ HTTPS / WS / Tauri IPC
                                    ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │                Frontend  (Next.js 15 + React 19)                │
   │                                                                 │
   │   ┌──────────┐  ┌──────────┐  ┌────────────┐  ┌──────────────┐  │
   │   │ Tabs:    │  │ Charts   │  │ Report Gen │  │ AI Assistant │  │
   │   │ TC HF    │  │ Recharts │  │ docx + pdf │  │ /api/chat    │  │
   │   │ LeTID    │  └──────────┘  └────────────┘  └──────────────┘  │
   │   │ BDT RCO  │  ┌────────────────────────────────────────────┐  │
   │   │ GCT      │  │  useWebSocket  (live + demo modes)         │  │
   │   └──────────┘  └────────────────────────────────────────────┘  │
   │                              │                                  │
   │   ┌────────────── Tauri 2 desktop shell (Rust) ──────────────┐  │
   │   └──────────────────────────────────────────────────────────┘  │
   └───────────────────────────────┬─────────────────────────────────┘
                                   │ WebSocket  ws://localhost:8000/ws/live
                                   │ REST       /api/device/status, /run, /stop
                                   ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │              Backend  (FastAPI + uvicorn, Python 3.11+)         │
   │                                                                 │
   │   ┌──────────────┐   ┌────────────────┐   ┌──────────────────┐  │
   │   │ main.py      │   │ test_programs/ │   │ mcp_server.py    │  │
   │   │ WS server    │   │ TC HF LeTID    │   │ Claude tools     │  │
   │   │ REST routes  │   │ BDT RCO GCT    │   │ + DB queries     │  │
   │   └──────┬───────┘   └────────┬───────┘   └──────────────────┘  │
   │          │                    │                                 │
   │          ▼                    ▼                                 │
   │   ┌──────────────────────────────────────┐    ┌──────────────┐  │
   │   │ scpi_driver.py (raw TCP SCPI client) │    │ database.py  │  │
   │   └──────────────────┬───────────────────┘    │ SQLite       │  │
   └──────────────────────┼────────────────────────┴──────────────┘
                          │ TCP  192.168.200.100:30000
                          ▼
                  ┌──────────────────┐
                  │ ITECH PV6000     │
                  │ DC Power Supply  │
                  └──────────────────┘
```

---

## Test Suite

| Tab    | Test                                       | Standard               | Key Parameters                         |
|--------|--------------------------------------------|------------------------|----------------------------------------|
| TC     | Thermal Cycling                            | IEC 61215-2 MQT11      | 200 cycles, -40 to +85 °C, I = Isc     |
| HF     | Humidity Freeze                            | IEC 61215-2 MQT12      | 85 %RH, +85 °C → -40 °C                |
| LeTID  | Light & Elevated Temp Induced Degradation  | IEC TS 63342:2022      | Idark = Isc - Imp @ 75 °C, 162 h       |
| BDT    | Bypass Diode Thermal                       | IEC 62979:2017         | 1.35 × Isc for 1 h                     |
| RCO    | Reverse Current Overload                   | IEC 61730-2 MST26      | 135 % fuse rating                      |
| GCT    | Ground Continuity                          | IEC 61730-2 MST13      | 25 A, R < 0.1 Ω                        |

---

## Prerequisites

| Tool       | Version       | Notes                                                                   |
|------------|---------------|-------------------------------------------------------------------------|
| Node.js    | 20 LTS or 22  | Install from <https://nodejs.org/>. After install, **reopen the shell**.|
| npm        | 10+           | Bundled with Node.js.                                                   |
| Python     | 3.11+         | Install from <https://www.python.org/>. On Windows tick "Add to PATH".  |
| pip        | 24+           | Bundled with Python.                                                    |
| Rust       | stable        | Required only for Tauri desktop builds (<https://rustup.rs/>).          |
| Git        | 2.40+         | Git Bash on Windows ships with the Git for Windows installer.           |
| ITECH      | PV6000        | Reachable on the LAN at `192.168.200.100:30000` (raw TCP SCPI).         |

Optional:
- **Playwright** for E2E smoke tests (installed automatically via `npm i` in `/tests`).
- **Docker** for the `docker-compose` dev stack.

---

## Quick Start — Git Bash (Windows / macOS / Linux)

```bash
# 1. Clone
git clone https://github.com/ganeshgowri-ASA/agnipariksha.git
cd agnipariksha

# 2. One-shot launcher (backend + frontend concurrently)
bash scripts/start_dev.sh

# --- OR run them individually ---

# 3a. Backend
cd backend
python -m pip install -r requirements.txt
python main.py            # http://localhost:8000

# 3b. Frontend  (new shell, MUST be inside ./frontend before npm run dev)
cd frontend
npm install
cp ../.env.example .env.local
npm run dev               # http://localhost:3000

# 4. Desktop app (Tauri)
cd frontend
npm run tauri
```

---

## Quick Start — PowerShell (Windows)

```powershell
# 1. Clone
git clone https://github.com/ganeshgowri-ASA/agnipariksha.git
Set-Location agnipariksha

# 2. One-shot launcher (backend + frontend concurrently)
powershell -ExecutionPolicy Bypass -File .\scripts\start_dev.ps1

# --- OR run them individually ---

# 3a. Backend
Set-Location backend
py -m pip install -r requirements.txt
py main.py                # http://localhost:8000

# 3b. Frontend  (new PowerShell window; MUST be inside .\frontend)
Set-Location frontend
npm install
Copy-Item ..\.env.example .env.local
npm run dev               # http://localhost:3000

# 4. Desktop app (Tauri)
Set-Location frontend
npm run tauri
```

> If PowerShell blocks the script, run once as admin:
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

---

## Troubleshooting

### `npm: command not found` (Git Bash or PowerShell)
Node.js is not installed or the shell was opened before PATH was updated.

1. Install Node.js **LTS** from <https://nodejs.org/>.
2. **Close every existing terminal** (Git Bash, PowerShell, VS Code integrated terminals).
3. Open a fresh shell and verify:
   ```bash
   node --version   # v20.x or v22.x
   npm  --version   # 10.x+
   ```

### `next: command not found` or `ENOENT package.json` when running `npm run dev`
You are running the command from the **wrong working directory**. `npm run dev` must be executed **inside `frontend/`** — that is where `package.json` lives.

```bash
# Wrong (repo root):
$ npm run dev
npm error code ENOENT
npm error syscall open
npm error path C:\…\agnipariksha\package.json

# Right:
$ cd frontend
$ npm run dev
```

### `python: command not found` / `'python' is not recognized` (Windows)
Python is installed but not on PATH. On Windows, use the **`py` launcher** that ships with the python.org installer:

```powershell
py --version                  # Python 3.11.x
py -m pip install -r requirements.txt
py main.py
```

If `py` is also missing, reinstall Python from <https://www.python.org/> and **tick "Add python.exe to PATH"** on the first installer screen.

### Frontend cannot reach backend (`WebSocket connection failed`)
- Confirm backend is running: <http://localhost:8000/docs> should load.
- Check `.env.local` contains `NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws/live`.
- A reverse proxy / VPN can rewrite `localhost` — disable it for local dev.

### Tauri build fails on Windows: `link.exe not found`
Install **Microsoft C++ Build Tools** (Desktop development with C++ workload) from
<https://visualstudio.microsoft.com/visual-cpp-build-tools/>, then reopen the shell.

---

## Verify ITECH Device Reachability

Before running a live test, confirm the PV6000 is reachable on the LAN. On Windows (PowerShell), use:

```powershell
powershell -Command "Test-NetConnection 192.168.200.100 -Port 30000"
```

A healthy response includes:
```
ComputerName     : 192.168.200.100
RemoteAddress    : 192.168.200.100
RemotePort       : 30000
TcpTestSucceeded : True
```

On macOS / Linux / Git Bash you can use `nc` instead:
```bash
nc -vz 192.168.200.100 30000
# Connection to 192.168.200.100 port 30000 [tcp/*] succeeded!
```

If the test fails:
1. Confirm the PC and PV6000 are on the same subnet (`ipconfig` / `ifconfig`).
2. Confirm the device IP in `backend/scpi_driver.py` matches the front-panel LAN settings.
3. Disable any Windows Firewall rule blocking outbound TCP/30000.
4. Power-cycle the PV6000 and re-test.

---

## Project Structure

```
agnipariksha/
├── .github/workflows/ci.yml      # CI: pytest + next build + playwright
├── backend/                      # FastAPI + SCPI driver + MCP server
│   ├── main.py                   # WebSocket + REST entrypoint
│   ├── scpi_driver.py            # ITECH PV6000 TCP SCPI client
│   ├── test_programs/            # TC, HF, LeTID, BDT, RCO, GCT orchestrators
│   ├── database.py               # SQLite test-run persistence
│   └── mcp_server.py             # Claude MCP tool surface
├── frontend/                     # Next.js 15 + React 19
│   ├── app/                      # App Router + /api routes
│   ├── components/
│   │   ├── tabs/                 # TC | HF | LeTID | BDT | RCO | GCT
│   │   └── ui/                   # shadcn primitives
│   └── hooks/useWebSocket.ts     # live + demo data
├── src-tauri/                    # Tauri 2 desktop wrapper (Rust)
├── scripts/
│   ├── start_dev.sh              # Git Bash launcher
│   └── start_dev.ps1             # PowerShell launcher
├── tests/                        # Playwright E2E smoke tests
├── docs/
│   ├── PRD.md
│   ├── GO_LIVE.md                # Go-live checklist
│   └── test-standards.md
├── CLAUDE.md                     # Claude Code IDE guide
└── README.md
```

---

## Go-Live Checklist

Before promoting a build to production hardware, run through **[docs/GO_LIVE.md](docs/GO_LIVE.md)** end-to-end. It covers ITECH reachability, calibration verification, safety interlocks, report sign-off, and rollback procedures.

---

*Built for PV module reliability by Agni Labs.*
