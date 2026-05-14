# SolarLabX → Agnipariksha mapping (2026-05-13)

Read-only clone of https://github.com/ganeshgowri-ASA/SolarLabX inspected
on 2026-05-13. SolarLabX is a Next.js 14 + Prisma stack focused on
IEC 61215-2 / 61853 / 60904 reliability analytics. Agnipariksha is a
Tauri + Next.js + FastAPI test station that drives an ITECH PV6000 and
runs IEC 61215-2 / 61730-2 / TS 63342 / 62804 protocols end-to-end.

## Direct adapter candidates (analysis modules, no test execution)

| SolarLabX module                                  | Our route                                  | Owner branch (state)                                           |
|---------------------------------------------------|--------------------------------------------|----------------------------------------------------------------|
| `components/data-analysis/ThermalCyclingTab.tsx`  | `/dashboard?tab=tc` and `/tests/thermal-cycling` | PR #21 `claude/iec-thermal-cycling-oTKGx` (draft)              |
| `components/data-analysis/HumidityFreezeTab.tsx`  | `/dashboard?tab=hf` and `/tests/humidity-freeze` | PR #18 `claude/iec-mqt12-humidity-freeze-GS97r` (draft)        |
| `components/data-analysis/DampHeatTab.tsx`        | `/dashboard?tab=dh` and `/tests/damp-heat`     | PR #16 `claude/iec-mqt13-damp-heat-9uV2o` (draft)              |
| `components/data-analysis/BypassDiodeAnalysis.tsx`| `/dashboard?tab=bdt` and `/tests/bypass-diode` | PR #20 `claude/iec-mqt18-bypass-diode-ZCYtI` (draft)           |
| `components/data-analysis/LeTIDAnalysis.tsx`      | `/dashboard?tab=letid` and `/tests/letid`     | PR #22 `claude/iec-letid-63342-4THCY` (draft)                  |
| `components/data-analysis/PIDTab.tsx`             | `/tests/pid` (currently aliased to `letid`)   | **no PR yet** — adopt SolarLabX module as base                  |
| `components/data-analysis/IEC60891Tab.tsx`        | STC / temperature-correction (Pmax fit)       | covered indirectly by PR #21 (TC) — port the IEC60891 chart code |
| `components/reports/charts/HumidityFreezeChart.tsx` | report PDF/DOCX in PR #18 + reports v2 (PR #28) | combine — strip Mitsui branding                                 |
| `components/reports/charts/LeTIDAnalysisChart.tsx`  | PR #22 report                                | combine                                                        |

## No direct counterpart in SolarLabX (Agnipariksha-only)

- Reverse Current Overload (IEC 61730-2 MST 26) — owner PR #17 `claude/reverse-current-overload-RedRJ`
- Ground Continuity (IEC 61730-2 MST 13) — owner PR #19 `claude/ground-continuity-orchestrator-QTiEG`
- Live SCPI control of ITECH PV6000 — out-of-scope for SolarLabX (analysis-only); covered by `feat/pv6000-scpi-control` scaffold.
- Fleet ticketing + scheduler + barcode/remote — Agnipariksha-only (PR #30, #29, #32).

## Architectural deltas

| Concern             | SolarLabX                  | Agnipariksha                                      |
|---------------------|----------------------------|--------------------------------------------------|
| Persistence         | Prisma + Postgres only     | SQLModel + Alembic; SQLite default + Railway/MS Access via `feat/db-connectors` |
| Hardware control    | none (analysis-only)       | SCPI driver, transport abstraction (PR #26)       |
| Auth                | NextAuth                   | JWT (PR #32) — AUTH_ENABLED=false in dev/demo     |
| Reports             | client-side only           | server-side python-docx + reportlab               |
| AI / MCP            | chatbot component          | threaded AI panel (PR #23 draft) + MCP scaffold (`feat/ai-mcp-keys`) |

## How to vendor an adapter (operator runbook)

1. Copy the relevant SolarLabX module into `frontend/lib/analysis/` (TS) or `backend/app/analysis/` (Python).
2. Prefix the file with: `// from solarlabx@<sha> path/to/file` for attribution.
3. Strip MCIND / Mitsui branding from any rendered text.
4. Wire it behind a feature flag (`NEXT_PUBLIC_FF_*`) so legacy tabs are never broken.
5. Add a pytest / playwright fixture that loads sample CSV rows from `data/runs/` and asserts the new chart renders.

## Tests with no SolarLabX equivalent → write from scratch in their own PR

- `feat/iec/reverse-current-overload` — IEC 61730-2 MST 26 (135% fuse rating)
- `feat/iec/ground-continuity` — IEC 61730-2 MST 13 (25 A, R < 0.1 Ω)
