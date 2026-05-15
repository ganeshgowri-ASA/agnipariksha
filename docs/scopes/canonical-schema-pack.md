# Canonical schema pack (2026-05-14 update)

This is the authoritative-source manifest for `feat/solarlab-x-sync` (S-D),
`feat/reports-v2` (S-F), `feat/predictive-maint` (S-G), `feat/fishbone-rca` (S-J),
and `feat/pv6000-scpi-control` (S-A).

## Source documents (uploaded by user on 2026-05-14)

1. `trf-Protocol-analysis-test-report-generation.xlsx` — 20+ sheets:
   Dashboard · Test Request Form · Incoming Inspection · MCIND Register ·
   Process Flowchart · Project Management Gantt ·
   Master Test List (MQT 01..22 + PID + LeTID) · STC Performance · Stabilisation ·
   VI · PID · Dark I-V · LeTID · EL Imaging · Ground Continuity · Insulation+WL ·
   Thermal Environmental · Equipment Calibration (15 instruments) ·
   Uncertainty Budget (GUM/GPG36; Pmax 2.8 % k=2) · IEC 61215 report ·
   IEC 61853 report · Document Checklist (25 ISO 17025 items) · Amendment Log.
2. `MCIND_1920_lb_006.V1-report-template-5.docx` — Mitsui Routine Diagnostics
   Test Package 1 (VI, EL, IR, STC, INS, WLT). Strip Mitsui branding; use as
   Word template for `feat/reports-v2`.
3. `Generic-Test-protocol-template-OLD-FORMATS-7.xlsx` — 55 protocol templates
   (full list below; maps to S-D protocol pages).
4. SS IEC 61215-2:2023 (IDT IEC 61215-2:2021) — authoritative procedures MQT 01..22.
   **Delta from prior scope:** NMOT removed; new MQT 20 cyclic dynamic mechanical
   load, MQT 21 PID, MQT 22 bending.
5. NREL LeTID interlab + IEC TS 63342 — 75 °C ISC-IMP detection (up to 4 weeks /
   162 h steps), 85 °C ISC regeneration (up to 500 h).

## Master test registry — IEC 61215-2:2021 MQT 01..22

| MQT | Test | Owner protocol page |
|---|---|---|
| 01 | Outdoor exposure | `/tests/outdoor-exposure` |
| 02 | Insulation | `/tests/insulation` |
| 03 | Wet leakage | `/tests/wet-leakage` |
| 04 | Performance at STC | `/tests/stc` |
| 05 | Performance at NMOT / low irradiance | `/tests/nmot-low-irr` |
| 06 | Temperature coefficient | `/tests/temp-coeff` |
| 07 | Bypass diode functionality / hotspot | `/tests/hotspot` |
| 08 | UV preconditioning | `/tests/uv-pre` |
| 09 | Hot-spot endurance | `/tests/hotspot-endurance` |
| 10 | UV exposure | `/tests/uv` |
| 11 | Thermal cycling | `/dashboard?tab=tc` (live) |
| 12 | Humidity freeze | `/dashboard?tab=hf` (live) |
| 13 | Damp heat | `/dashboard?tab=dh` (live) |
| 14 | Robustness of terminations | `/tests/terminations` |
| 15 | Wet leakage (re-test) | `/tests/wet-leakage-2` |
| 16 | Static mechanical load | `/tests/mech-load` |
| 17 | Hail impact | `/tests/hail` |
| 18 | Bypass diode thermal | `/dashboard?tab=bdt` (live) |
| 19 | Stabilisation | `/tests/stabilisation` |
| 20 | **Cyclic dynamic mechanical load** *(new in 2021)* | `/tests/dml-cyclic` |
| 21 | **PID — IEC 62804** *(new MQT designator in 2021)* | `/tests/pid` |
| 22 | **Bending** *(new in 2021)* | `/tests/bending` |

Plus IEC TS 63342 LeTID and IEC 61730-2 safety (MST 13 GCT, MST 26 RCO).

## 55 protocol templates (from generic-test-protocol xlsx)

BPDT · CC · DH · Dry Heat · HF · Mat Creep · TC · Durab Marking · Bifacial ·
Hotspot · Max Power · Low Irr · STC/NMOT · NOCT · Temp Coeff · VI · Hail ·
DMLT · Accessibility · Cut · GCT · Impulse V · CBT · INS · WLT · PID · IR ·
Lap shear · Peel · Sharp edge · SMLT · Retention JB · Cord P · Cord torsion ·
Insulation thick · Reverse overload · MBT · Screw connect A · Screw connect B ·
Terminal box · UV Pre 2005 · UV Pre 2016 · NOCT Det · Outdoor Exposure ·
PD · EL · Stabilisation.

Each maps to a protocol page under `/tests/<slug>` and a row in the
Master Test List XLSX export.

## (a) Test pages now backed by canonical schemas

Currently on main (`d6817351`), the live registry in `frontend/types/test-session.ts`
exposes **7 tabs** — `tc, hf, letid, bdt, rco, gct, dh`. After S-D + S-A land, the
following pages will be backed by the canonical schemas:

- `/dashboard?tab=tc`   ← MQT 11
- `/dashboard?tab=hf`   ← MQT 12
- `/dashboard?tab=dh`   ← MQT 13
- `/dashboard?tab=bdt`  ← MQT 18 (+ MQT 07 hot-spot via shared analysis)
- `/dashboard?tab=letid` ← IEC TS 63342
- `/dashboard?tab=rco`  ← IEC 61730-2 MST 26
- `/dashboard?tab=gct`  ← IEC 61730-2 MST 13

S-D adds protocol-page coverage (no live SCPI control needed for analysis-only
pages) for the remaining MQT 01..10, 14..17, 19..22 and 28 additional generic
protocols.

## (b) Deltas vs current `tests/` registry

| Item | Current `main` | Authoritative source | Action |
|---|---|---|---|
| Tab count | 7 (tc/hf/letid/bdt/rco/gct/dh) | 22 MQT + LeTID + 2 MST + 55 generic | Keep 7 live tabs; add analysis-only routes for the rest under `/tests/[slug]` |
| MQT 21 PID label | `letid` aliased | Distinct MQT 21 (IEC 62804) | Add separate `/tests/pid` route, keep `/tests/letid` separate (IEC TS 63342) |
| MQT 20 DML cyclic | not present | new in 2021 | Add `/tests/dml-cyclic` |
| MQT 22 bending | not present | new in 2021 | Add `/tests/bending` |
| MQT 05 NMOT label | not present | IEC removed NMOT in 2021; treat as "low irradiance" only | Rename, do not lose the temperature-coeff path |
| LeTID detection profile | 162 h sun-hours, generic | NREL: 75 °C × 162 h steps × 4 weeks | Set as default param in LeTID orchestrator |
| LeTID regeneration | not implemented | 85 °C ISC, up to 500 h | Add regeneration phase to orchestrator |
| Pmax uncertainty | not exposed in UI | 2.8 % at k=2 (GUM/GPG36) | Surface in report header + reports v2 budget section |
| Master Test List sheet | none | 21-test register | Generate XLSX export from the TestRun table (PR #27) |
| Equipment Calibration sheet | implicit via Equipment (PR #25) | 15 instruments, due dates | Wire `/api/calibration/alerts` to PR #25's Equipment table |
| ISO 17025 Document Checklist | none | 25 items | New `/admin/iso17025` page, backed by AuditLog table |
| Uncertainty Budget | none | GUM / GPG36 | Add per-test section in reports v2 (S-F) |
| Amendment Log | none | required by ISO 17025 | New table + `/admin/amendments` page |

## (c) ETA to merged S-F and S-D

These are **scope updates only** (this commit). Implementation cost in
attached-session-days, assuming one session per branch with the existing
SCPI + SQLModel + Reports infrastructure already on main:

- `feat/solarlab-x-sync` (S-D): **3–5 attached-session-days**
  - Vendor 5–7 SolarLabX analysis modules + add 28 protocol page stubs +
    extend `frontend/types/test-session.ts` with the full registry.
  - Bulk of the work is the 28 protocol pages (`/tests/[slug]` already exists
    as a redirect router; just needs per-slug content components).
- `feat/reports-v2` (S-F): **4–6 attached-session-days**
  - Mitsui .docx as the python-docx template (strip-then-merge).
  - 20-sheet XLSX export via `openpyxl`.
  - PDF via headless Chromium print (already have reportlab fallback).
  - Embedded graphs (matplotlib server-side, already in PR #28's spec).
  - Signed-URL raw-data deep links.
- `feat/predictive-maint` (S-G): **3–4 attached-session-days** — adds the
  rolling-z + isolation-forest detector and wires Equipment Calibration as the
  asset registry (depends on PR #25 schema which is on main).
- `feat/fishbone-rca` (S-J): **2–3 attached-session-days** — 6M Ishikawa SVG +
  CRUD on RCA entries + embed in Reports v2.
- `feat/pv6000-scpi-control` (S-A): **5–7 attached-session-days** including
  bench-side acceptance with the actual instrument. Cannot be parallelised
  with someone else's safety-critical changes; needs sole ownership of the
  driver layer until merged.

**Hard dependencies** (cannot start before the dependency lands):
- S-J depends on S-F (RCA section in reports).
- S-G's "Predictive section in reports" depends on S-F.
- S-K (remote-control) depends on S-A (driver) and S-E (web-server).

EOF
mv -f docs/scopes/canonical-schema-pack.md.tmp docs/scopes/canonical-schema-pack.md 2>/dev/null || true
