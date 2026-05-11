# 🔥 Agnipariksha
### PV Reliability Test Station
**by Shreshtata Power Supplies**

> *अग्निपरीक्षा — Trial by Fire. Where PV Modules Prove Themselves.*

![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Web%20%7C%20Desktop-green)
![Stack](https://img.shields.io/badge/stack-Tauri%20%2B%20Next.js%20%2B%20FastAPI-orange)
![AI](https://img.shields.io/badge/AI-Claude%20MCP-purple)

---

## What is Agnipariksha?

Agnipariksha is a full-stack application that **programs the ITECH IT6000C DC Power Supply** to execute standardized PV module reliability tests, with real-time monitoring, AI-powered analysis, and automated report generation in Word & PDF.

## 🧪 Supported Tests

| # | Test | Standard | Duration |
|---|------|----------|----------|
| 1 | **Thermal Cycling (TC)** | IEC 61215-2 MQT 11 | 200 cycles |
| 2 | **Humidity Freeze (HF)** | IEC 61215-2 MQT 12 | 10 cycles |
| 3 | **LeTID** | IEC TS 63342:2022 | 162+ hours |
| 4 | **Bypass Diode Thermal (BDT)** | IEC 62979:2017 | 1 hour |
| 5 | **Reverse Current Overload (RCO)** | IEC 61730-2 MST 26 | Per sequence |
| 6 | **Ground Continuity (GCT)** | IEC 61730-2 MST 13 | < 2 min |

## ✨ Features

- 🔌 **Direct SCPI control** of ITECH IT6000C over LAN (no LabVIEW required)
- 📊 **Real-time strip charts** for Voltage, Current, Power
- ⚡ **6 dedicated test tabs** with wizards, live monitors, data tables
- 🤖 **Claude AI MCP** for anomaly detection, LeTID prediction, NL queries
- 📄 **Auto-report generation** in Word (.docx) and PDF
- 🖥️ **Runs as web app** (Vercel) OR **desktop app** (Tauri .exe installer)
- 🎭 **Demo mode** with 12 pre-loaded test scenarios (PASS + FAIL)
- 🌙 **Industrial dark theme** matching IT9000 software aesthetics

## 🛠️ Tech Stack

```
Frontend:  Next.js 14 + React 18 + TypeScript + Tailwind CSS
Desktop:   Tauri 2.x (Rust)
Charts:    Recharts + ECharts
Tables:    TanStack Table v8
Backend:   FastAPI + Python 3.11
Database:  TimescaleDB (PostgreSQL time-series)
Hardware:  SCPI/TCP → ITECH IT6000C
Reports:   docx.js + jsPDF
AI:        Claude 3.5 Sonnet MCP
```

## 🚀 Quick Start

```bash
git clone https://github.com/ganeshgowri-ASA/agnipariksha
cd agnipariksha

# Web mode
docker-compose up -d
cd frontend && npm install && npm run dev

# Desktop mode
cd frontend && npm run tauri dev
```

See [CLAUDE.md](./CLAUDE.md) for full setup guide and Claude Code IDE instructions.

## 📁 Project Structure

```
agnipariksha/
├── frontend/          # Next.js + Tauri
├── backend/           # FastAPI + SCPI driver
├── src-tauri/         # Tauri Rust shell
├── docs/              # PRD, architecture, standards
└── docker-compose.yml
```

## 📄 Documentation

- [PRD & Requirements](./docs/PRD.md)
- [Architecture](./docs/architecture.md)
- [Test Standards](./docs/test-standards.md)
- [API Reference](./docs/api-reference.md)
- [Claude Code IDE Guide](./CLAUDE.md)

---

*Built for Shreshtata Power Supplies — Surat, Gujarat, India*  
*ITECH IT6000C Series | IT9000 PV6000 v1.0.3.3*
