# SolarLabX → Agnipariksha reuse map

**Date:** 2026-05-13
**Source repo:** [`ganeshgowri-ASA/SolarLabX`](https://github.com/ganeshgowri-ASA/SolarLabX) — Next.js + TypeScript, deployment target Vercel, last push 2026-05-13 03:39 UTC, default branch `main`.
**Destination repo:** [`ganeshgowri-ASA/agnipariksha`](https://github.com/ganeshgowri-ASA/agnipariksha) — Next.js (frontend) + FastAPI (backend) + Tauri shell.

This map drives **STEP 3 vendoring** in the audit pivot. Modules are pulled
file-by-file (with attribution: `# from solarlabx@<sha> path/to/file`)
into `frontend/lib/analysis/` (TypeScript) and `backend/app/analysis/`
(Python ports of the math). Agnipariksha's existing test tabs become
**thin call sites** — no duplicated logic.

---

## 1. Per-test analysis modules

| IEC test | solarlabx file | size | Target in agnipariksha |
|---|---|---|---|
| Thermal Cycling — IEC 61215-2 MQT 11 | `components/data-analysis/ThermalCyclingTab.tsx` | 22.8 KB | `frontend/lib/analysis/thermal_cycling.ts` (math) → consumed by `components/tabs/ThermalCyclingTab.tsx` analysis sub-tab |
| Humidity Freeze — MQT 12 | `components/data-analysis/HumidityFreezeTab.tsx` | 27.1 KB | `frontend/lib/analysis/humidity_freeze.ts` → `components/tabs/HumidityFreezeTab.tsx` |
| Damp Heat — MQT 13 | `components/data-analysis/DampHeatTab.tsx` | 22.5 KB | `frontend/lib/analysis/damp_heat.ts` → `components/tabs/DampHeatTab.tsx` |
| PID — IEC 61215 / 61701 | `components/data-analysis/PIDTab.tsx` | 21.7 KB | `frontend/lib/analysis/pid.ts` → consumed by a new `/tests/pid` tab (currently aliased to LeTID by the redirect map) |
| LeTID — IEC TS 63342 | `components/data-analysis/LeTIDAnalysis.tsx` | 17.6 KB | `frontend/lib/analysis/letid.ts` + Python sibling `backend/app/analysis/letid.py` (per audit pivot STEP 4) → `components/tabs/LeTIDTab.tsx` |
| Bypass Diode — MQT 18 / 62979 | `components/data-analysis/BypassDiodeAnalysis.tsx` | 26.1 KB | `frontend/lib/analysis/bypass_diode.ts` + `backend/app/analysis/bypass_diode.py` (Tj derivation; replaces the inline -2 mV/°C in `backend/app/ai/tools.py`) → `components/tabs/BypassDiodeTab.tsx` |
| Reverse Current Overload — IEC 61730-2 MST 26 | embedded inside `app/(dashboard)/reports/templates/iec-61730/page.tsx` (73 KB). Carve out the analysis section into a fresh `components/data-analysis/ReverseCurrentTab.tsx` upstream **then** vendor — opening a small PR against SolarLabX is the cleaner path. Until then, port the relevant subroutine inline. | — | `frontend/lib/analysis/reverse_current.ts` → `components/tabs/ReverseCurrentTab.tsx` |
| Ground Continuity / Bonding — MST 13 | `components/electrical-safety/SafetyTestWorkflow.tsx` (9.8 KB) + the iec-61730 template above | — | `frontend/lib/analysis/ground_continuity.ts` → `components/tabs/GroundContinuityTab.tsx` |

## 2. Shared substrate (vendor once, reuse everywhere)

| Concern | solarlabx file | size | Target |
|---|---|---|---|
| Math core | `components/data-analysis/AnalysisEngine.tsx` | 10.4 KB | `frontend/lib/analysis/engine.ts` |
| Plotting (recharts wrappers, Pmax / Tj / EL views) | `components/data-analysis/AnalysisCharts.tsx` | 29.5 KB | `frontend/lib/analysis/charts.tsx` |
| Validation | `components/data-analysis/DataValidation.tsx` | 5.5 KB | `frontend/lib/analysis/validation.ts` |
| Raw-data CSV import | `components/data-analysis/RawDataImport.tsx` | 10.8 KB | `frontend/lib/analysis/import.ts` |
| SPC control charts | `components/data-analysis/SPCControlCharts.tsx` | 17.2 KB | `frontend/lib/analysis/spc.tsx` |
| Stats overview | `components/data-analysis/StatisticsOverview.tsx` + `app/statistics/page.tsx` (67.7 KB) | 13.9 KB + 67.7 KB | `frontend/lib/analysis/statistics.ts` |
| Export to report bridge | `components/data-analysis/ExportPanel.tsx` + `ExportToProtocol.tsx` | 6.1 KB + 20.9 KB | `frontend/lib/analysis/export.ts` (informs `feat/reports-v2-thorough`) |
| IV-curve plot | `components/iec60904/IVCurveChart.tsx` | 2.1 KB | `frontend/lib/analysis/iv_curve.tsx` |
| Calibration chain viz | `components/iec60904/CalibrationChainViz.tsx` | 1.1 KB | `frontend/lib/analysis/calibration_chain.tsx` |
| Linearity chart | `components/iec60904/LinearityChart.tsx` | 1.4 KB | `frontend/lib/analysis/linearity.tsx` |
| EL / IR imaging | `components/data-analysis/ELIRImagingTab.tsx` | 23.4 KB | `frontend/lib/analysis/el_ir.tsx` (also feeds the LeTID EL view in STEP 4) |
| Temperature coefficient | `components/data-analysis/TemperatureCoeffAnalysis.tsx` | 24.2 KB | `frontend/lib/analysis/temp_coeff.ts` |
| Bifaciality | `components/data-analysis/BifacialityAnalysis.tsx` | 21.0 KB | `frontend/lib/analysis/bifaciality.ts` |
| Stabilization | `components/data-analysis/StabilizationAnalysis.tsx` | 23.7 KB | `frontend/lib/analysis/stabilization.ts` |
| Gates analysis | `components/data-analysis/GatesAnalysis.tsx` | 21.0 KB | `frontend/lib/analysis/gates.ts` (drives the existing `GATE2_PMAX_DELTA_PERCENT` constant) |
| NMOT / NOCT | `components/data-analysis/NMOTCalculator.tsx` + `app/nmot-noct/page.tsx` | 16.2 KB + 16.0 KB | `frontend/lib/analysis/nmot.ts` |
| IV curve full page | `app/iv-curve/page.tsx` | 27.2 KB | reference for `frontend/lib/analysis/iv_curve.tsx` |

## 3. Reports v2 — direct template lift

`feat/reports-v2-thorough` consumes these wholesale (PDF + Word skeletons
already include cover page, IEC clause table, raw-data path, time-series
graphs, pass/fail block, signature block):

| solarlabx template | agnipariksha target |
|---|---|
| `app/(dashboard)/reports/templates/thermal-cycling/page.tsx` (3.3 KB) | `frontend/components/reports/templates/ThermalCyclingReport.tsx` |
| `humidity-freeze/page.tsx` (3.8 KB) | `HumidityFreezeReport.tsx` |
| `damp-heat/page.tsx` (4.4 KB) | `DampHeatReport.tsx` |
| `letid/page.tsx` (45.2 KB) | `LeTIDReport.tsx` |
| `pid/page.tsx` (59.6 KB) | `PIDReport.tsx` |
| `iec-61215/page.tsx` (79.8 KB) | `IEC61215Report.tsx` (umbrella — covers TC/HF/DH/MQT 18) |
| `iec-61730/page.tsx` (73.0 KB) | `IEC61730Report.tsx` (umbrella — covers MST 13/26) |
| `iec-61853/page.tsx` (17.3 KB) | `IEC61853Report.tsx` (energy rating) |
| `iec-61701/page.tsx` (17.7 KB) | `PIDCorrosionReport.tsx` |
| `mechanical-load/page.tsx` (5.9 KB) | `MechanicalLoadReport.tsx` |
| `uv-preconditioning/page.tsx` (7.3 KB) | `UVPreconditioningReport.tsx` |
| `calibration/page.tsx` (7.8 KB) | feeds `feat/predictive-maintenance` |

## 4. Scheduler / Gantt — redirect `feat/scheduler-gantt-next-slot` work

`feat/scheduler-gantt-next-slot` (PR #29) was started before this audit.
Per **STEP 6**, vendor instead of building from scratch. Source files:

| solarlabx file | size | Target |
|---|---|---|
| `components/chamber-tests/ChamberScheduleGantt.tsx` | 5.7 KB | `frontend/components/scheduler/Gantt.tsx` |
| `ChamberLoadingPlan.tsx` | 3.9 KB | `frontend/components/scheduler/LoadingPlan.tsx` |
| `ChamberStatusDashboard.tsx` | 7.9 KB | `frontend/components/scheduler/StatusDashboard.tsx` |
| `ChamberUtilizationChart.tsx` | 5.2 KB | `frontend/components/scheduler/UtilizationChart.tsx` |
| `ChamberTestsManager.tsx` | 13.7 KB | `frontend/components/scheduler/TestsManager.tsx` |
| `CyclesReview.tsx` | 8.6 KB | `frontend/components/scheduler/CyclesReview.tsx` |

## 5. Equipment / calibration / predictive maintenance — redirect `feat/predictive-maintenance`

| solarlabx file | size | Target |
|---|---|---|
| `components/equipment/CalibrationCertificates.tsx` | 27.4 KB | `frontend/components/equipment/CalibrationCertificates.tsx` |
| `IntermediateChecks.tsx` | 30.1 KB | `frontend/components/equipment/IntermediateChecks.tsx` |
| `EquipmentCalendarView.tsx` | 24.4 KB | `frontend/components/equipment/CalendarView.tsx` |
| `EquipmentSchedulingDashboard.tsx` | 7.3 KB | `frontend/components/equipment/SchedulingDashboard.tsx` |
| `EquipmentDashboardClient.tsx` | 25.7 KB | `frontend/components/equipment/EquipmentDashboardClient.tsx` |
| `EquipmentRegistry.tsx` | 4.6 KB | `frontend/components/equipment/EquipmentRegistry.tsx` |
| `EquipmentFormDialog.tsx` | 9.0 KB | `frontend/components/equipment/EquipmentFormDialog.tsx` |
| `IntermediateChecks.tsx` MTBF/Weibull math | excerpt → `backend/app/reliability/mtbf.py` (already exists; merge `weibull_shape`/`weibull_scale_hours` formulas line-by-line) |

## 6. Other surfaces worth vendoring later (out of scope for the immediate train)

- **Audit / CAR / Findings** (`components/audit/*`, `app/(dashboard)/audit/*`) — feeds future `feat/audit-trail`.
- **QMS / CAPA / Compliance** (`components/customer/*`, `app/(dashboard)/qms/*`, `RCAAnalysis.tsx`, `FMEAWorksheet.tsx`) — feeds future `feat/qms`.
- **Uncertainty calculator + budget** (`app/(dashboard)/uncertainty/*`) — useful for IEC 61215 reports v2 confidence intervals.
- **SOP-gen** (`components/dashboard/chatbot/ChatbotClient.tsx`, `app/(dashboard)/sop-gen/*`) — could replace `frontend/components/AIAssistant.tsx`'s SOP-drafting behaviour later.
- **Vision-AI** (`components/vision-ai/*`, `app/(dashboard)/vision-ai/*`) — EL defect detection; feeds the LeTID EL view + future `feat/vision-ai`.
- **IEC 60904 reference pages** (`app/iec60904/part-{1..13}/page.tsx`) — long-form clause text; can replace `backend/app/data/iec_clauses.json` short excerpts.

## Vendoring rules

1. Each ported file gets a header banner:
   ```ts
   /**
    * Ported from ganeshgowri-ASA/SolarLabX@<sha>
    *   src: components/data-analysis/<File>.tsx
    * Vendored 2026-05-13 by chore/solarlabx-audit-and-reuse-map.
    *
    * Changes from upstream:
    *   - <list any deltas: typing tightened, props normalised, etc.>
    */
   ```
2. **Math goes in the lib**, **rendering stays in the tab**. The
   agnipariksha tab passes a `LiveReading[]` and gets back a typed
   `AnalysisResult`. No business logic in the JSX.
3. **No duplicated logic.** If a formula already exists in agnipariksha
   (e.g. Pmax delta in `frontend/types/test-session.ts`'s
   `GATE2_PMAX_DELTA_PERCENT`), the ported file *imports* and exports a
   thin wrapper rather than re-declaring.
4. Python ports in `backend/app/analysis/` mirror the TS exports
   one-to-one so the backend AI agent (`backend/app/ai/tools.py`) can
   call `recompute_analysis(run_id)` and get identical numbers to the
   browser preview.

## Truncation note

GitHub's tree API truncated the response after `components/iec60904/`.
A second pass is needed before STEP 3 commits to confirm:
- whether RCO / MST 26 has its own analysis component (vs being inline
  inside `iec-61730` template),
- everything under `lib/`, `utils/`, `hooks/`, `prisma/`, `db/` (data
  model — relevant to `feat/db-connectors`).

That pass is the first task on the consuming feat branch (e.g.
`feat/db-connectors` does it for `prisma/`, `feat/reports-v2-thorough`
does it for the report templates' shared CSS). It's not blocking this
audit doc.
