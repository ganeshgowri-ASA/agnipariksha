# 🔥 Agnipariksha (अग्निपरीक्षा)
### PV Module Reliability Test Station

> *Agnipariksha* — Sanskrit for "Trial by Fire" — the ultimate test of resilience.

A full-stack web + desktop application for programming the **ITECH PV6000 DC Power Supply** to perform 6 IEC-standard PV module reliability tests.

---

## 🧪 Test Suite

| Tab | Test | Standard | Key Parameters |
|-----|------|----------|----------------|
| **TC** | Thermal Cycling | IEC 61215-2 MQT11 | 200 cycles, -40 to +85°C, I=Isc |
| **HF** | Humidity Freeze | IEC 61215-2 MQT12 | 85%RH, +85°C → -40°C |
| **LeTID** | Light & Elevated Temp Induced Degradation | IEC TS 63342:2022 | Idark=Isc-Imp @ 75°C, 162h |
| **BDT** | Bypass Diode Thermal | IEC 62979:2017 | 1.35×Isc for 1h |
| **RCO** | Reverse Current Overload | IEC 61730-2 MST26 | 135% fuse rating |
| **GCT** | Ground Continuity | IEC 61730-2 MST13 | 25A, R < 0.1Ω |
| **DH** | Damp Heat | IEC 61215-2 MQT 13 | 85°C / 85%RH, 1000h |

---

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Python 3.11+
- Rust (for Tauri desktop build)

### 1. Clone
```bash
git clone https://github.com/ganeshgowri-ASA/agnipariksha
cd agnipariksha
```

### 2. Frontend (Web)
```bash
cd frontend
npm install
cp ../.env.example .env.local        # edit with your API keys
npm run dev                          # auto-kills any orphan on :3000, then starts Next.js
# Open http://localhost:3000
```

`npm run dev` runs `kill-port 3000 && next dev --turbopack -p 3000`, so a
stale Node from a previous session (the source of both `EADDRINUSE :::3000`
and the `EPERM ... @next/swc-win32-x64-msvc ... next-swc.win32-x64-msvc.node`
during reinstall) is reaped before the new server starts. If you ever need
the old behaviour, use `npm run dev:noclean`.

There are also platform-specific wrappers that do the same thing plus walk
listeners via `lsof` / `Get-NetTCPConnection`:

```bash
bash frontend/scripts/dev.sh         # Git Bash / macOS / Linux
pwsh frontend/scripts/dev.ps1        # Windows PowerShell
```

### 3. Backend (FastAPI — needed for live hardware)
The ASGI app is `main:app` (i.e. `backend/main.py`), **not** `app.main:app`.

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000     # canonical
# or use the wrapper scripts:
bash backend/run.sh                                       # Git Bash / macOS / Linux
pwsh backend/run.ps1                                      # Windows PowerShell
# or, from the repo root:
python -m backend                                         # equivalent fallback
# Runs on http://localhost:8000
```

### 4. Run both, one liner

Git Bash on Windows:
```bash
cd ~/agnipariksha \
  && (bash frontend/scripts/dev.sh &) \
  && bash backend/run.sh
```

…or two separate terminals:
```bash
# Terminal 1 — frontend
cd ~/agnipariksha/frontend && npm run dev

# Terminal 2 — backend
cd ~/agnipariksha/backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

### 5. Desktop App (Tauri)
```bash
cd frontend
npm run tauri
# Builds native .exe / .dmg / .deb
```

---

## 🎨 UI Features
- 📊 **Real-time strip charts** (Recharts) — Voltage, Current, Power vs time
- 🌡️ **Analog gauges** matching ITECH IT9000 style
- 🗂️ **Data tables** with per-row export
- 📄 **Word & PDF report generation** (docx.js + jsPDF) per test
- 🤖 **Claude AI Assistant** — anomaly detection, compliance Q&A
- 🎞️ **Demo mode** — 12 pre-loaded pass/fail scenarios
- 🔌 **Live hardware mode** — toggle to connect real ITECH PV6000

---

## 🛠️ Hardware
- **Device**: ITECH PV6000 Series DC Power Supply
- **Software**: IT9000 v1.0.3.3
- **Connection**: TCP SCPI at `192.168.200.100:30000`
- **Protocol**: Raw TCP socket, SCPI command set

---

## 🤖 AI MCP Capabilities
1. Analyse all test results — pass/fail summary
2. Detect anomalies in live V/I/P data
3. LeTID degradation trend prediction
4. IEC compliance check against limits
5. SCPI command generation from NL queries
6. Automated test report narrative

Requires `ANTHROPIC_API_KEY` in `.env.local`

---

## 📁 Project Structure
```
agnipariksha/
├── frontend/           # Next.js 15 + React 19
│   ├── app/            # App Router + AI API route
│   ├── components/
│   │   ├── tabs/       # TC, HF, LeTID, BDT, RCO, GCT
│   │   └── ui/         # Primitives (shadcn)
│   ├── hooks/          # useWebSocket
│   └── src-tauri/      # Tauri desktop wrapper (Rust)
├── backend/            # FastAPI + SCPI driver
└── CLAUDE.md           # Claude Code IDE guide
```

---

*Built with ❤️ for PV module reliability by Agni Labs*
