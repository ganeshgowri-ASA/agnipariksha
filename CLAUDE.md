# Agnipariksha — Claude Code IDE Setup

## Project Overview
PV Module Reliability Test Station — programs the **ITECH PV6000** DC power supply for six IEC reliability tests (TC, HF, LeTID, BDT, RCO, GCT). Frontend ships as Next.js web + Tauri desktop; backend is FastAPI with a raw-TCP SCPI driver and a Claude MCP layer for analytics.

## Project Map
```
agnipariksha/
├── .github/workflows/ci.yml    # CI: backend pytest + frontend build + playwright
├── backend/
│   ├── main.py                 # FastAPI app — WebSocket /ws/live + REST /api/*
│   ├── scpi_driver.py          # ITECH PV6000 raw-TCP SCPI client
│   ├── test_programs/          # One orchestrator per IEC test
│   │   ├── tc.py    # IEC 61215 MQT11
│   │   ├── hf.py    # IEC 61215 MQT12
│   │   ├── letid.py # IEC TS 63342
│   │   ├── bdt.py   # IEC 62979
│   │   ├── rco.py   # IEC 61730 MST26
│   │   └── gct.py   # IEC 61730 MST13
│   ├── database.py             # SQLite persistence for test runs
│   └── mcp_server.py           # Claude MCP tool surface
├── frontend/
│   ├── app/                    # Next.js App Router
│   │   ├── page.tsx            # Dashboard with 8 tabs
│   │   └── api/                # /api/chat, /api/device/status, …
│   ├── components/
│   │   ├── tabs/               # TC | HF | LeTID | BDT | RCO | GCT
│   │   ├── ReportGenerator.tsx
│   │   └── ui/                 # shadcn primitives
│   └── hooks/useWebSocket.ts
├── src-tauri/                  # Tauri 2 desktop shell (Rust)
├── scripts/                    # start_dev.sh / start_dev.ps1
├── tests/                      # Playwright E2E smoke tests
└── docs/                       # PRD, GO_LIVE checklist, test standards
```

## Dev Commands
```bash
# One-shot launcher (backend + frontend)
bash scripts/start_dev.sh           # Git Bash / macOS / Linux
./scripts/start_dev.ps1             # PowerShell

# Individually
cd frontend && npm install && npm run dev          # http://localhost:3000
cd backend  && pip install -r requirements.txt && python main.py   # :8000
cd frontend && npm run tauri                        # desktop
```

## Key Files
- `frontend/app/page.tsx` — Main dashboard with 8 tabs
- `frontend/components/tabs/` — One component per test (see TestTabLayout pattern)
- `frontend/hooks/useWebSocket.ts` — Live data + demo mode
- `frontend/components/ReportGenerator.tsx` — docx + pdf export
- `backend/scpi_driver.py` — All ITECH SCPI commands live here
- `backend/test_programs/*.py` — Test orchestrators
- `backend/main.py` — WebSocket + REST API surface
- `backend/mcp_server.py` — Claude MCP tools

## Hardware Config
- ITECH PV6000 IP: `192.168.200.100:30000` (raw TCP SCPI)
- Demo mode: top-right toggle in the UI
- Reachability check (PowerShell):
  `powershell -Command "Test-NetConnection 192.168.200.100 -Port 30000"`

## Test Standards
| Tab | Standard           | Key Parameter                  |
|-----|--------------------|--------------------------------|
| TC  | IEC 61215 MQT11    | 200 cycles -40 to +85 °C       |
| HF  | IEC 61215 MQT12    | 85 %RH, +85 to -40 °C          |
| LeTID | IEC TS 63342     | Idark = Isc - Imp @ 75 °C 162h |
| BDT | IEC 62979          | 1.35 × Isc @ 1 h               |
| RCO | IEC 61730 MST26    | 135 % fuse rating              |
| GCT | IEC 61730 MST13    | 25 A, R < 0.1 Ω                |

## Branching Strategy
- `main` — protected; only merged via PR after CI green.
- Feature branches off `main`, named:
  - `feat/<scope>-<short-desc>` — new functionality (e.g. `feat/backend-scpi-driver`)
  - `fix/<scope>-<short-desc>` — bug fixes
  - `chore/<scope>-<short-desc>` — docs, CI, tooling, refactors with no behavior change
  - `claude/<task>-<slug>` — branches driven by Claude Code sessions
- One feature per PR. Open as **Draft** until tests pass locally, then mark Ready.
- Squash-merge into `main` with a Conventional-Commit title:
  `feat(backend): add ITECH PV6000 SCPI driver`.
- Tag releases as `vMAJOR.MINOR.PATCH` once `main` is stable.

## Extending Test Orchestrators
Each IEC test lives as a self-contained module under `backend/test_programs/`. To add a new test (or a new variant of an existing one):

1. **Create the orchestrator** in `backend/test_programs/<name>.py`. Mirror the existing modules: expose an async `run(params, ws_sink, scpi)` coroutine that
   - validates `params` against the IEC limits for the test,
   - calls into `scpi_driver.py` only — never open raw sockets here,
   - streams datapoints via `await ws_sink.push({...})` every sample tick,
   - returns a `TestResult` with `pass_fail`, `summary`, and the full sample table.
2. **Register the route** in `backend/main.py` by adding a `/api/tests/<name>/run` endpoint that resolves params, opens a websocket sink, and awaits the orchestrator.
3. **Add a frontend tab** under `frontend/components/tabs/<Name>Tab.tsx` using `TestTabLayout`. Wire it to `useWebSocket` and `ReportGenerator`.
4. **Add the entry to** the dashboard tab list in `frontend/app/page.tsx`.
5. **Document the standard** in `docs/test-standards.md` and update the table above.
6. **Cover it with tests**:
   - backend unit test under `backend/test_programs/test_<name>.py` exercising the param validator and the pass/fail logic against a mocked `scpi`,
   - frontend Playwright smoke under `tests/` that loads the tab and asserts the chart renders.

## Coding Guidelines
- All SCPI command strings live in `backend/scpi_driver.py`. Orchestrators must not embed SCPI literals.
- All live data flows through the `useWebSocket` hook — components never open their own sockets.
- Test tabs follow the `TestTabLayout` shell (header, params, chart, table, report button).
- Report generation goes through `frontend/components/ReportGenerator.tsx` (docx + jsPDF).
- New backend modules must include type hints and a `__doc__` summary; new frontend modules must be typed TS (no `any`).
- Never modify behavior of `/backend` or `/frontend` in a docs/CI PR — keep diffs scoped.

## AI MCP
Add to `.env.local`:
```
ANTHROPIC_API_KEY=your-key-here
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws/live
```
The MCP surface lives in `backend/mcp_server.py` and exposes: anomaly detection, LeTID degradation prediction, IEC compliance Q&A, SCPI synthesis, and report-narrative generation.

## Go-Live
Run `docs/GO_LIVE.md` end-to-end before promoting any build to production hardware.
