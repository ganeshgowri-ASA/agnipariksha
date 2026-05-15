# Cloud Claude Code sessions audit — 2026-05-13

**Window:** last 72 h (PRs updated since 2026-05-10T15:00 UTC).
**Scope:** All PR activity on `ganeshgowri-ASA/agnipariksha` is the
canonical proxy for cloud-coding-session state — this account's session
list is not directly enumerable via the GitHub MCP scope, so a PR has a
1:1 relationship with a session in practice.
**Source data:** `mcp__github__list_pull_requests(state=all, sort=updated, dir=desc)` — 25 PRs returned.

## Summary table

| PR | Title | Branch | State | Last commit | Notes |
|---|---|---|---|---|---|
| 37 | feat(ui-ux): unified chrome | `feat/ui-ux-pass-1` | merged | 2026-05-15 04:03 | This session |
| 36 | chore(deploy): Windows-resilient deploy.sh | `chore/deploy-windows-resilience` | merged | 2026-05-13 14:05 | This session |
| 35 | docs(lessons-log): seed log | `chore/lessons-log-2026-05-12` | merged | 2026-05-12 10:45 | |
| 32 | V2-S7 barcode/QR + remote + mobile | `claude/barcode-remote-mobile-s2ebN` | closed | 2026-05-14 14:01 | Closed by stale sweep; will re-open with focused scope |
| 30 | feat(tickets): unified ticketing | `claude/unified-ticket-system-B8250` | merged | 2026-05-12 13:55 | |
| 29 | feat(scheduler): /api/scheduler/* + Gantt UI | `claude/scheduler-gantt-next-slot-NzkvE` | **merged** | 2026-05-14 13:59 | **dedupe (post-merge)** — see below |
| 28 | feat(reports): v2 engine | `claude/reports-v2-sections-HwZru` | closed | 2026-05-13 13:54 | **dedupe** — vendor SolarLabX templates |
| 27 | feat(db): SQLModel + Alembic + CSV backfill | `claude/add-sqlmodel-alembic-ldict` | merged | 2026-05-12 12:37 | Foundation for `feat/db-connectors` |
| 26 | feat(backend): pluggable hardware transport | `claude/add-transport-abstraction-G1kdh` | merged | 2026-05-12 12:29 | Foundation for `feat/multi-supply-rack` |
| 25 | feat(reliability): MTBF/Weibull + spares | `claude/reliability-mtbf-predictive-hf619` | merged | 2026-05-13 08:04 | **dedupe (partial)** — merge SolarLabX `IntermediateChecks.tsx` Weibull math line-by-line |
| 22 | feat(letid): IEC TS 63342 | `claude/iec-letid-63342-4THCY` | closed | 2026-05-13 13:54 | **dedupe** — vendor `LeTIDAnalysis.tsx` |
| 21 | feat(iec): MQT 11 thermal cycling | `claude/iec-thermal-cycling-oTKGx` | closed | 2026-05-13 13:54 | **dedupe** — vendor `ThermalCyclingTab.tsx` |
| 20 | feat(mqt18): bypass diode | `claude/iec-mqt18-bypass-diode-ZCYtI` | closed | 2026-05-13 13:54 | **dedupe** — vendor `BypassDiodeAnalysis.tsx` |
| 19 | feat(iec/ground-continuity): MST 13 | `claude/ground-continuity-orchestrator-QTiEG` | closed | 2026-05-13 13:54 | **dedupe** — vendor `SafetyTestWorkflow.tsx` + iec-61730 |
| 18 | feat(iec-mqt12): humidity freeze | `claude/iec-mqt12-humidity-freeze-GS97r` | closed | 2026-05-13 13:54 | **dedupe** — vendor `HumidityFreezeTab.tsx` |
| 17 | feat(rco): MST 26 | `claude/reverse-current-overload-RedRJ` | closed | 2026-05-13 13:54 | **dedupe** — carve out from `iec-61730` template |
| 16 | feat(damp-heat): MQT 13 | `claude/iec-mqt13-damp-heat-9uV2o` | closed | 2026-05-13 13:54 | **dedupe** — vendor `DampHeatTab.tsx` |
| 8 | feat(frontend): six IEC test tabs UI | `claude/build-test-tabs-nvSVN` | closed | 2026-05-13 13:54 | **dedupe (partial)** — shells stay, analysis swap to libs |
| 7 | feat(frontend): shell, theme, layout | `claude/frontend-shell-setup-Vb72m` | closed | 2026-05-13 13:54 | Superseded by #37 |
| 6 | chore: docs, scripts, CI, QA | `claude/docs-qa-integration-wNU2F` | closed | 2026-05-13 13:53 | |
| 5 | feat(backend): FastAPI app + WS | `feat/backend-api-ws` | closed | 2026-05-13 13:53 | Superseded by what's on `main` |
| 4 | feat(backend): six IEC orchestrators | `feat/backend-test-orchestrators` | closed | 2026-05-13 13:53 | **dedupe (partial)** — math → `backend/app/analysis/` |
| 3 | feat: MCP server + Tauri wrapper | `claude/mcp-tauri-integration-nakjj` | closed | 2026-05-13 13:53 | |
| 2 | feat(frontend): Results + AI Assistant | `claude/frontend-results-ai-tabs-mpE9W` | closed | 2026-05-13 13:53 | |
| 1 | feat(backend): SCPI driver for ITECH PV6000 | `feat/backend-scpi-driver` | closed | 2026-05-13 13:53 | Superseded by `backend/scpi_async.py` on `main` |

There are **no open PRs** in the 72 h window beyond the ones in the
single-train pipeline that are queued for this session.

## Dedupe candidates (vs SolarLabX)

Each entry below is a PR whose scope overlaps with a SolarLabX module
called out in `SOLARLABX-REUSE-MAP-2026-05-13.md`. Action column says
how to resolve.

| PR | Status | Supersede with | Action |
|---|---|---|---|
| #29 scheduler/gantt | **merged — needs swap** | `components/chamber-tests/Chamber{ScheduleGantt,LoadingPlan,StatusDashboard,UtilizationChart,TestsManager,CyclesReview}.tsx` (§4 of map) | Open `feat/scheduler-vendor-from-solarlabx` to swap implementations and delete the from-scratch versions. |
| #28 reports v2 | closed | All `app/(dashboard)/reports/templates/*` (§3 of map) + `Export{Panel,ToProtocol}.tsx` | Re-open as `feat/reports-v2-thorough` with vendor lift instead of from-scratch. |
| #25 reliability MTBF | **merged — needs partial graft** | `components/equipment/IntermediateChecks.tsx` Weibull math (§5) | Patch `backend/app/reliability/mtbf.py` to import / replicate the upstream `weibull_shape`/`weibull_scale_hours` formulas with attribution. |
| #22 LeTID | closed | `components/data-analysis/LeTIDAnalysis.tsx` + `reports/templates/letid/page.tsx` | Vendor in `feat/db-connectors`-adjacent vendor branch (per STEP 3). |
| #21 TC | closed | `components/data-analysis/ThermalCyclingTab.tsx` + `reports/templates/thermal-cycling/page.tsx` | Vendor. |
| #20 BDT | closed | `BypassDiodeAnalysis.tsx` (also retires the inline -2 mV/°C in `backend/app/ai/tools.py`) | Vendor as TS + Python sibling. |
| #19 GCT | closed | `electrical-safety/SafetyTestWorkflow.tsx` + `reports/templates/iec-61730/page.tsx` | Vendor. |
| #18 HF | closed | `HumidityFreezeTab.tsx` + `reports/templates/humidity-freeze/page.tsx` | Vendor. |
| #17 RCO | closed | Carve-out from `reports/templates/iec-61730/page.tsx` | Vendor. |
| #16 DH | closed | `DampHeatTab.tsx` + `reports/templates/damp-heat/page.tsx` | Vendor. |
| #8 IEC tabs UI | closed | tab shells stay; analysis logic comes from `frontend/lib/analysis/*` | Partial — keep on lessons-log only. |
| #4 backend orchestrators | closed | math portions → `backend/app/analysis/*` | Partial — orchestration glue stays. |

## Train state (post-audit)

```
merged on main
─ #36 Windows-resilient deploy.sh         (2026-05-13)
─ #37 ui-ux-pass-1                        (2026-05-15)

queued for the single-train pipeline (gated on this audit landing)
─ feat/db-connectors                      (next)
─ feat/multi-supply-rack
─ feat/pv6000-live-integration
─ feat/troubleshooting-guide              (richer write-up; stub already on main)
─ feat/reports-v2-thorough                (vendor SolarLabX templates)
─ feat/predictive-maintenance             (graft Weibull math from SolarLabX)
─ feat/error-logging
─ docs/review/UX-FREEZE-2026-05-13.md     (final HOLD point — no .exe until "freeze approved, package now")

vendor-redirect branches (interleaved as preconditions to the above)
─ chore/solarlabx-vendor-shared           (engine.ts, charts.tsx, validation.ts, import.ts, spc.tsx)
─ chore/solarlabx-vendor-iec-tabs         (TC/HF/DH/PID/LeTID/BDT/RCO/GCT lib modules)
─ chore/solarlabx-vendor-scheduler        (swap #29's from-scratch impl)
─ chore/solarlabx-vendor-reports          (templates → reports v2)
─ chore/solarlabx-vendor-equipment        (calibration + intermediate-checks)
```

## Notes & caveats

- The SolarLabX reuse pivot landed **after** PRs #16–22, #28, #29, #25
  were already in flight or merged. The merged ones (#25, #29) need
  **post-merge swap PRs** rather than reverts — keeping the API surface
  stable and only replacing the implementation.
- "Cloud-coding-session" enumeration is approximated by PR list because
  the Claude Code session API is not exposed to this MCP scope. If a
  session exists with no PR yet, it won't appear here. None such are
  known to exist.
- The **17 stale PRs closed in the 2026-05-13 sweep** (#1–8, #16–22,
  #28, #32) are still listed above for completeness but have already
  been formally retired.
