# QA Harness

This document describes the two automated test surfaces shipped with
Agnipariksha and how to run them locally and in CI.

| Surface | Location | Runner | Purpose |
|---|---|---|---|
| Frontend tab-level smoke | `frontend/tests/e2e/test-tabs-smoke.spec.ts` | Playwright | Catch render-blocking regressions in every operator-facing sub-tab |
| Backend analysis harness | `backend/tests/test_analysis.py` | pytest | Pin IEC pass/fail boundaries for each MQT / MST clause |

Both harnesses are wired into `.github/workflows/ci.yml` and run on
every PR against `main`.

---

## 1. Frontend — Playwright tab-level smoke

### What it covers

For each of the seven IEC test tabs (Thermal Cycling, Humidity
Freeze, LeTID, Bypass Diode, Reverse Current Overload, Ground
Continuity, Damp Heat) the smoke navigates to `/dashboard?tab=<key>`
and asserts that every sub-tab renders without throwing:

| Sub-tab | data-testid | Notes |
|---|---|---|
| Setup | `subtab-pane-setup` | Per-test parameter form |
| Live Monitor | `subtab-pane-monitor` | Gauges + charts (demo telemetry) |
| Data Table | `subtab-pane-data` | Paginated CSV table |
| Analysis | `subtab-pane-analysis` | ΔPmax vs Gate-2 |
| Report | `subtab-pane-report` | PDF / DOCX export form |
| Basic Check | `subtab-pane-basic-check` | Thermal Cycling only — preflight gate |

Plus a single test that the top-level `/overview` page renders all six
KPI cards.

### Running locally

```bash
cd frontend
npm ci
npx playwright install --with-deps chromium
npm run test:e2e -- tests/e2e/test-tabs-smoke.spec.ts
```

Playwright auto-starts `next dev` on port 3000 unless one of
`PW_NO_SERVER`, `PLAYWRIGHT_NO_WEB_SERVER`, or `E2E_SKIP_WEBSERVER` is
set. To target an already-running dev server:

```bash
E2E_SKIP_WEBSERVER=1 E2E_BASE_URL=http://127.0.0.1:3000 \
  npx playwright test tests/e2e/test-tabs-smoke.spec.ts
```

### Adding a new sub-tab

1. Render the sub-tab's content inside `TestTabLayout` with a wrapper
   that carries `data-testid="subtab-pane-<key>"`.
2. Add the sub-tab to the `subTabs` array in
   `frontend/components/TestTabLayout.tsx` so the trigger button
   acquires `data-testid="subtab-<key>"` automatically.
3. Append the new key to one of the `test.describe` blocks in
   `test-tabs-smoke.spec.ts`. Keep them parameterised over the seven
   IEC tests when the new sub-tab is global; create a focused block
   when it's test-specific (see Basic Check as an example).

---

## 2. Backend — pytest analysis harness

### What it covers

`backend/app/analysis/iec_pass_fail.py` exposes deterministic verdict
helpers for every IEC clause the lab runs. `test_analysis.py` exercises
each helper with table-driven pass / fail / boundary / insufficient-data
fixtures.

| IEC clause | Helper | Threshold |
|---|---|---|
| 61215-2 MQT 11 — Thermal Cycling | `pmax_delta_verdict` | ΔPmax ≥ −5% |
| 61215-2 MQT 12 — Humidity Freeze | `pmax_delta_verdict` | ΔPmax ≥ −5% |
| 61215-2 MQT 13 — Damp Heat | `pmax_delta_verdict` | ΔPmax ≥ −5% |
| TS 63342:2022 — LeTID | `letid_verdict` | ΔPmax ≥ −2% |
| 62979:2017 — Bypass Diode | `bypass_diode_verdict` | peak Tj ≤ 128 °C |
| 61730-2 MST 13 — Ground Continuity | `ground_continuity_verdict` | max R = V/I ≤ 0.1 Ω |
| 61730-2 MST 26 — Reverse Current | `reverse_current_verdict` | max I ≤ 1.05 × test_current |

The −5% Gate-2 floor is published as
`GATE2_PMAX_DELTA_PERCENT` in both
`backend/app/analysis/iec_pass_fail.py` and
`frontend/types/test-session.ts`. A constant-pinning test
(`test_gate2_threshold_pinned`) makes any silent drift a CI failure.

### Running locally

```bash
cd backend
pip install -r requirements.txt
pytest -q tests/test_analysis.py
```

`pytest.ini` already sets `asyncio_mode = auto` and `testpaths =
tests`, so an unscoped `pytest -q` picks the new file up too.

### Fixture conventions

* All readings use millisecond timestamps spaced 500 ms apart so the
  series look like real `/ws/telemetry` traffic.
* Each verdict has at least one of every outcome — `PASS`, `FAIL`,
  `INSUFFICIENT_DATA` — and exercises the value that lands exactly on
  the boundary (because boundary semantics are easy to flip when
  refactoring).

### Adding a new IEC clause

1. Add a verdict helper to
   `backend/app/analysis/iec_pass_fail.py` that returns an
   `AnalysisResult`.
2. Re-export it from `backend/app/analysis/__init__.py`.
3. Add a `pytest.mark.parametrize` table to
   `backend/tests/test_analysis.py` covering pass / fail / boundary /
   insufficient-data. The boundary case is mandatory.
4. If the helper introduces a new constant that the frontend also
   needs, mirror it in `frontend/types/test-session.ts` and add a
   pinning test alongside `test_gate2_threshold_pinned`.

---

## CI wiring

`.github/workflows/ci.yml` already runs:

* `backend` job → `pytest -q` (picks up `test_analysis.py`).
* `e2e` job → `npx playwright test` (picks up
  `test-tabs-smoke.spec.ts` via `testMatch` in
  `playwright.config.ts`).

Both jobs must pass for a PR to merge.

## Cross-references

* `docs/test-standards.md` — IEC clause reference.
* `frontend/components/AnalysisPanel.tsx` — frontend mirror of the
  pass/fail logic.
* `frontend/components/TestTabLayout.tsx` — owner of the
  `subtab-*` test IDs.
