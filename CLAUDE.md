# Agnipariksha — Claude Code IDE Setup

## Project Overview
PV Module Reliability Test Station — programs ITECH PV6000 DC power supply for 6 IEC tests.

## Architecture
```
agnipariksha/
├── frontend/          # Next.js 15 + Tauri 2 app
│   ├── app/           # Next.js App Router
│   ├── components/    # React components
│   │   ├── tabs/      # 6 test tab components (TC, HF, LeTID, BDT, RCO, GCT)
│   │   └── ui/        # shadcn/ui primitives
│   └── hooks/         # useWebSocket (demo + live modes)
├── backend/           # FastAPI + SCPI driver
│   ├── main.py        # WebSocket server
│   └── scpi_driver.py # ITECH PV6000 TCP SCPI driver
└── src-tauri/         # Tauri desktop wrapper
```

## Dev Commands
```bash
# Frontend (web)
cd frontend && npm install && npm run dev

# Backend
cd backend && pip install -r requirements.txt && python main.py

# Desktop app (Tauri)
cd frontend && npm run tauri
```

## Key Files
- `frontend/app/page.tsx` — Main dashboard with 8 tabs
- `frontend/components/tabs/` — One component per test
- `frontend/hooks/useWebSocket.ts` — Live data + demo mode
- `backend/scpi_driver.py` — ITECH SCPI commands
- `backend/main.py` — FastAPI WebSocket server

## Hardware Config
- ITECH PV6000 IP: `192.168.200.100:30000` (from device.xml)
- Protocol: Raw TCP SCPI
- Demo mode: Toggle in top-right of UI

## Test Standards
| Tab | Standard | Key Parameter |
|-----|----------|---------------|
| TC | IEC 61215 MQT11 | 200 cycles -40 to +85°C |
| HF | IEC 61215 MQT12 | 85%RH, +85 to -40°C |
| LeTID | IEC TS 63342 | Idark = Isc-Imp @ 75°C, 162h |
| BDT | IEC 62979 | 1.35×Isc @ 1h |
| RCO | IEC 61730 MST26 | 135% fuse rating |
| GCT | IEC 61730 MST13 | 25A, R < 0.1Ω |

## AI MCP
Add to `.env.local`:
```
ANTHROPIC_API_KEY=your-key-here
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws/live
```

## Coding Guidelines
- Keep all SCPI commands in `backend/scpi_driver.py`
- Use `useWebSocket` hook for all live data
- Each test tab follows TestTabLayout pattern
- Report generation: `frontend/components/ReportGenerator.tsx`

## Procurement Mocks (MSW)
`/api/procurement/{rfq,po,vendor}` is mocked client-side by Mock Service
Worker. The mocks live in `frontend/mocks/` and ship with a deterministic
seed (12 vendors, 50 RFQs, 30 POs). The browser worker boots from
`MswProvider` and is hard-disabled in production builds. Dev opt-out:
`NEXT_PUBLIC_MSW=0`. Playwright forces it on via the webServer env.
