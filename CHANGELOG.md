# Changelog

## Unreleased

### Fixed

- **Root cause: SCPI router file existed since PR #40 but the smoke that
  proves it stays mounted on the FastAPI app did not.** Symptoms reported
  from the lab host: all `/api/scpi/*` returned 404 locally despite the
  repo containing `backend/scpi_router.py` and `main.py` already calling
  `app.include_router(scpi_router)` on `origin/main`. The 404s came from
  running a stale local feature branch (`feat/scpi-console`) that was
  behind `main`. **Fix:** explicit smoke test
  (`backend/tests/test_scpi_routes_mounted.py`) that asserts
  `/api/scpi/transport`, `/api/scpi/idn`, and `/api/scpi/query?cmd=*IDN?`
  are mounted (status != 404) and fails CI if a future merge ever drops
  the `include_router(scpi_router)` line. Verified the test fails when
  the include is commented out and passes when it's present.
