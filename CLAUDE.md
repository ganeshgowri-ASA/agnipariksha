# Agnipariksha — PV Reliability Test Station
**by Shreshtata Power Supplies**

## Project Overview
This application programs the **ITECH IT6000C DC Power Supply** (via IT9000/PV6000 software) to run 6 standardized PV module reliability tests:

| Test | Tab | Standard |
|------|-----|----------|
| Thermal Cycling | TC | IEC 61215-2 MQT 11 |
| Humidity Freeze | HF | IEC 61215-2 MQT 12 |
| LeTID | LeTID | IEC TS 63342:2022 |
| Bypass Diode Thermal | BDT | IEC 62979:2017 |
| Reverse Current Overload | RCO | IEC 61730-2 MST 26 |
| Ground Continuity | GCT | IEC 61730-2 MST 13 |

## Tech Stack
- **Frontend**: Next.js 14 + React 18 + TypeScript + Tailwind CSS
- **Desktop**: Tauri 2.x (Rust backend, WebView frontend)
- **Charts**: Recharts (live) + ECharts (IV curves, heatmaps)
- **Tables**: TanStack Table v8
- **Backend**: FastAPI (Python 3.11) + TimescaleDB
- **Hardware**: SCPI over TCP → ITECH IT6000C at 192.168.200.100:30000
- **Reports**: docx.js (Word) + jsPDF (PDF)
- **AI**: Claude MCP via Anthropic SDK

## Hardware Connection
```
ITECH IT6000C DC Power Supply
  IP: 192.168.200.100
  Port: 30000 (TCP SCPI socket)
  Protocol: SCPI over raw TCP
  Software: IT9000 PV6000 v1.0.3.3
```

## Directory Structure
```
agnipariksha/
├── frontend/          # Next.js 14 app (also served by Tauri)
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── tests/
│   │       ├── tc/page.tsx      # Thermal Cycling
│   │       ├── hf/page.tsx      # Humidity Freeze
│   │       ├── letid/page.tsx   # LeTID
│   │       ├── bdt/page.tsx     # Bypass Diode Thermal
│   │       ├── rco/page.tsx     # Reverse Current Overload
│   │       └── gct/page.tsx     # Ground Continuity
│   ├── components/
│   │   ├── LiveMonitor.tsx      # Real-time V/I/P strip charts
│   │   ├── AnalogGauge.tsx      # Dial gauges matching IT9000 style
│   │   ├── TestDataTable.tsx    # TanStack Table for raw data
│   │   ├── ReportGenerator.tsx  # Word + PDF export
│   │   └── AIAssistant.tsx      # Claude MCP chat panel
│   └── lib/
│       ├── scpi.ts              # SCPI command builder
│       ├── websocket.ts         # WS client for live data
│       └── mcp-client.ts        # Claude MCP client
├── backend/           # FastAPI Python backend
│   ├── main.py
│   ├── scpi_driver.py           # TCP SCPI driver for IT6000C
│   ├── test_programs/
│   │   ├── thermal_cycling.py
│   │   ├── humidity_freeze.py
│   │   ├── letid.py
│   │   ├── bypass_diode.py
│   │   ├── reverse_current.py
│   │   └── ground_continuity.py
│   ├── models.py                # Pydantic models
│   ├── database.py              # TimescaleDB connection
│   └── mcp_server.py            # Claude MCP tools server
├── src-tauri/         # Tauri Rust backend
│   ├── src/
│   │   ├── main.rs
│   │   └── scpi_tcp.rs          # Native TCP SCPI connection
│   └── tauri.conf.json
├── docs/
│   ├── PRD.md
│   ├── architecture.md
│   ├── test-standards.md
│   └── api-reference.md
├── .env.example
├── docker-compose.yml           # TimescaleDB + backend
└── package.json
```

## Getting Started

### Prerequisites
- Node.js 20+
- Python 3.11+
- Rust (for Tauri desktop build)
- Docker (for TimescaleDB)
- ITECH IT6000C connected on LAN at 192.168.200.100

### Install & Run (Web Mode)
```bash
# 1. Start database
docker-compose up -d timescaledb

# 2. Start backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# 3. Start frontend
cd frontend
npm install
npm run dev
# Open http://localhost:3000
```

### Run as Desktop App
```bash
cd frontend
npm run tauri dev      # Development
npm run tauri build    # Build .exe installer
```

## Claude Code IDE Tips
- Always test SCPI commands in `backend/scpi_driver.py` first with `connect_test.py`
- Use `DEMO_MODE=true` in `.env` for testing without hardware
- Each test program in `backend/test_programs/` follows the same interface
- Live data flows: SCPI → FastAPI → WebSocket → Recharts

## Key SCPI Commands (IT6000C)
```
*IDN?                          # Identify instrument
SOUR:VOLT <value>              # Set voltage
SOUR:CURR <value>              # Set current
OUTP ON/OFF                    # Output enable/disable
MEAS:VOLT?                     # Measure voltage
MEAS:CURR?                     # Measure current
MEAS:POW?                      # Measure power
SOUR:VOLT:PROT <value>         # OVP level
SOUR:CURR:PROT <value>         # OCP level
LIST:VOLT <v1,v2,...>          # Program voltage steps
LIST:CURR <i1,i2,...>          # Program current steps
LIST:DWEL <t1,t2,...>          # Program step durations
LIST:COUN <n>                  # Program repeat count
LIST:STAT ON                   # Start program
```

## Environment Variables
See `.env.example` for all required variables.
