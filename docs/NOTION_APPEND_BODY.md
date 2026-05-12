# RELEASE v1.0.0 — Lessons, Mistakes, Milestones, Learnings

> Paste this block as a new H1 section under the existing Agnipariksha runbook
> (Notion page id `35d3f809bd1f80e58af8c043cbe1d43e`). Plain-text; no slash
> commands; safe to copy verbatim.

---

## A. Milestones

- **v0.9.0-checkpoint-2026-05-12** — pinned reproducibility tag with
  SHA256SUMS and release notes (PR #15). The rollback anchor; `git checkout`
  on this tag must continue to boot the app end-to-end.
- **Branch train (one squash-merge per area, v0.9.x patch bump per merge):**
  - feat/iec/mqt11-thermal-cycling   → v0.9.1
  - feat/iec/mqt12-humidity-freeze   → v0.9.2
  - feat/iec/mqt13-damp-heat         → v0.9.3
  - feat/iec/letid-63342             → v0.9.4
  - feat/iec/ground-continuity       → v0.9.5
  - feat/iec/reverse-current-overload → v0.9.6
  - feat/iec/mqt18-bypass-diode      → v0.9.7
  - docs/prd-v2                      → v0.9.8 (merged as PR #24)
  - feat/db/sqlmodel-alembic         → v0.9.9
  - feat/transports/pluggable        → v0.9.10
  - feat/reports/v2-sections         → v0.9.11
  - feat/reliability/mtbf-pm         → v0.9.12
  - feat/tickets/unified             → v0.9.13
  - feat/scheduler/gantt             → v0.9.14
  - feat/barcode-remote-mobile       → v0.9.15
  - feat/ai/threaded-assistant       → v0.9.16
  - feat/overview/360                → v0.9.17 (PR #31, this train's final)
- **v1.0.0-release-2026-05-12** — annotated tag after the 20/20 PRD v2.0
  checklist passes; release artifacts include SHA256SUMS of the frontend
  bundle plus a sample PDF and DOCX rendered from a demo Damp-Heat run.

## B. Mistakes & fixes (pulled from commit history and the working sessions)

1. **Stale Next 15.3.0 RSC error** — `Cannot find module 'react-server-dom-turbopack/...'`
   surfaced after a minor Next bump. Fix: delete `.next` + `node_modules`,
   pin Next to `^15.5.18`, reinstall. Captured in `fix/clean-frontend-modules`.
2. **Orphan PID 15208 holding :3000 across restarts** — caused
   `EADDRINUSE` loops on Windows where `npm run dev` re-spawned the dev
   server while a previous instance was still bound. Fix: `kill-port 3000`
   in `dev` script + a `start.ps1`/`start.sh` that explicitly clears the
   ports before launch.
3. **`taskkill <PID_ON_3000>` literal in docs** — a placeholder leaked
   verbatim into the runbook and into one PR description. Fix: replace with
   `npx kill-port 3000 8000`, which works on every shell we support.
4. **MINGW double-slash gotcha** — `taskkill //F //PID` is required on
   Git-Bash on Windows; the single-slash form passes the args to the bash
   path translator and silently no-ops. Documented in the deploy runbook.
5. **Missing `backend/__init__.py`** — pytest discovery skipped the package
   on a clean checkout. Fix: add the empty `__init__.py` and an explicit
   `tool.pytest.ini_options.rootdir = backend` in `pyproject.toml`.
6. **`nano` locking the shell in CI** — early scripts opened `nano` for
   "interactive review" steps and hung the runner until timeout. Hard rule
   added to CLAUDE.md and the deploy script: never invoke nano; use
   heredocs / `sed` / `git apply` only.
7. **Shallow AI v1 lacking conversation threading** — first AI assistant
   was stateless single-shot; reviewers could not chain "explain Tj for this
   run" → "now compare to MQT11 limits". Rebuilt in
   `feat/ai/threaded-assistant` with per-module thread persistence.
8. **No database; CSV-only persistence** — early on every run was a CSV
   under `artifacts/`. Made cross-test queries (MTBF, fleet pass-rate)
   impossible. `feat/db/sqlmodel-alembic` introduces SQLite at
   `data/agnipariksha.db` with Module / TestRun tables; CSV remains the
   on-disk source of truth and the DB mirrors at commit time.
9. **Monolithic PR approach** — the first attempt put DB + reports + UI
   into one branch. Reviews stalled for a week. Abandoned in favour of
   parallel bite-sized Claude Code sessions (one branch per area, one PR per
   branch, squash-merge with version bump). Train is now the standard.

## C. Learnings (durable rules)

- **Feature-flag every new capability.** `NEXT_PUBLIC_FF_DB`,
  `_FF_RELIABILITY`, `_FF_SCHEDULER`, `_FF_TICKETS` default OFF so V2 areas
  can dark-launch without breaking existing tabs. The flag layer lives in
  `frontend/lib/featureFlags.ts` (one source of truth).
- **CSV remains the source of truth; the DB is a mirror.** Recovery from a
  bad migration is `rm data/agnipariksha.db && alembic upgrade head` — the
  ground-truth data is still on disk.
- **Per-device LIVE/DEMO pill.** Every test tab shows the current device
  mode in its header; demo data path is colour-distinct from live so
  reviewers never mistake one for the other.
- **Squash-merge one branch at a time + version bump = clean rollback.**
  Each v0.9.x tag is a known-good restart point. `git checkout v0.9.<n>`
  always boots.
- **IEC-accurate scope beats generic scaffolding:**
  - Thermal Cycling chart must match IEC 61215 Figure 7 shape (the dwell
    profile), not just "a temperature sawtooth".
  - Humidity Freeze chart must match IEC 61215 Figure 9.
  - Bypass Diode Phase A: scatter Vf vs. Tj, linear fit `Vf = m·T + c`
    with `m` in mV/°C. Phase B: `Tj = (Vf_hot − c) / m`.
  - LeTID dose is tracked in **sun-hours**, not wall-clock.
  - Default datasheet `Tj_max` margin is **10 °C**.
- **Feature-flagged dark launches prevent breakage.** New surface
  (`/overview`) ships behind `NEXT_PUBLIC_FF_OVERVIEW` (default ON); legacy
  `/dashboard` is untouched.
- **Always include raw-data absolute path and IEC clause reference in
  every generated report.** A PDF that doesn't say where the CSV is and
  which clause was applied is useless in an audit.

## D. Playbook for the next release

1. **Branch train order**: IEC tabs first (MQT11 → 12 → 13 → 18 → LeTID
   → GCT → RCO), then PRD doc, then infra (DB, transports), then product
   (reports v2, reliability, tickets, scheduler, barcode, threaded AI),
   then 360° overview last. Reason: overview reuses every other slice's
   data shapes, so it always lands on top.
2. **Gate script per branch (must all be green before merge):**
   ```
   npm run lint
   npx tsc --noEmit
   npx next build
   pytest -q
   bash scripts/smoke.sh
   ```
3. **Rollback tag discipline.** Keep `v0.9.0-checkpoint-2026-05-12`
   immortal. Every later tag must `git checkout` cleanly and boot.
4. **Notion-as-runbook.** Every release appends a single H1 section here
   with milestones / mistakes / learnings / playbook / KPIs. The doc
   compounds — never overwrite, only append.
5. **Parallel Claude Code sessions for bite-sized scope.** One session
   per branch, with a tight CLAUDE.md describing the local conventions.
   Multiple sessions can run concurrently because each session only
   touches its designated branch.
6. **Reports always include**:
   - The absolute path to the raw CSV
   - The IEC clause (e.g., `IEC 61215-2 MQT 11`)
   - The pre/post `Pmax` and the `Δ%` against the `GATE2_PMAX_DELTA_PERCENT`
     threshold (`-5%`).

## E. KPIs from the final smoke run

(Fill in after `bash scripts/smoke.sh` exits 0 on the merged main.)

| Metric | Value |
|---|---|
| `GET /` | 200 (after redirect through `/overview`) |
| `GET /overview` | 200 |
| `GET /dashboard` | 200 |
| `GET /tests/thermal-cycling` | 307 → `/dashboard?tab=tc` |
| `GET /tests/humidity-freeze` | 307 → `/dashboard?tab=hf` |
| `GET /tests/damp-heat` | 307 → `/dashboard?tab=dh` |
| `GET /tests/bypass-diode` | 307 → `/dashboard?tab=bdt` |
| `GET /tests/letid` | 307 → `/dashboard?tab=letid` |
| `GET /tests/reverse-current` | 307 → `/dashboard?tab=rco` |
| `GET /tests/ground-continuity` | 307 → `/dashboard?tab=gct` |
| `GET /api/health` | 200 (with `scpi_reachable: bool`) |
| `POST /api/reports/generate` (PDF) | size ≥ 50 KB |
| `POST /api/reports/generate` (DOCX) | size ≥ 30 KB |
| `pytest -q` | _N passed_ |
| `playwright test` | _N passed_ |
| `smoke.sh` | exit 0 |

---

_End of v1.0.0 lessons section. Paste above this divider._
