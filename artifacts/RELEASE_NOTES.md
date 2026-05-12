# v0.9.0-checkpoint-2026-05-12

Stable checkpoint after final hardening pass. All 7 IEC tabs live
(TC, HF, LID, BDT, RCO, GCT, DH), backend `/api/health` deep check OK,
`/api/reports/generate` produces valid PDF, demo SCPI simulator green,
Shreshtata branding live, frontend running Next.js 15.5.18 Turbopack
on :3000, backend uvicorn on :8000. Use this tag for rollback if
subsequent IEC-depth work regresses.

## Provenance

- main HEAD at tag time: `ab3db4bd2db0ecc43933293cea095e1d4df95915`
- merged PR: [#14 — chore: hardening pass](https://github.com/ganeshgowri-ASA/agnipariksha/pull/14)
- CI on the merge run (backend / frontend / smoke): all green

## What's in the box

- Backend (FastAPI 1.1.0)
  - `GET /health` — terse legacy
  - `GET /api/health` — deep: `{status, demo, version, scpi_reachable, scpi_target, disk_free_mb, uptime_s}`
  - `WS /ws/telemetry` — 5 s heartbeat, demo-aware, query-param test_id/mqt/interval
  - `WS /ws/live` — legacy preserved
  - `POST /api/scpi`, `POST /api/tests/{id}/control`
  - SCPI: async TCP with lock + capped exponential reconnect + DemoSimulator
    (profiles for MQT11/12/13/18/21, RCO, GCT, LeTID)
  - pytest: 12 / 12 pass
- Frontend (Next 15.5.18 / React 19.2.6)
  - 7 IEC tabs reachable as `/tests/<slug>` deep links + `/dashboard`
  - System-health pill in header polls `/api/health` every 5 s
  - `/api/reports/generate` returns a spec-valid 1-page PDF (no extra deps)
  - `/api/health` proxies the backend deep check
- Tooling
  - `bash deploy.sh` one-click local deploy
  - `bash scripts/smoke.sh` — 12-assertion smoke harness, exit 0
  - GitHub Actions: backend / frontend / smoke jobs, all green on merge

## Attached artifacts

| file | size | sha256 |
|------|------|--------|
| `frontend-bundle-static.tar.gz` | 714 940 B | `299140020a4ffb89ce15048ae39ccb4f1bd30811dca8e6f80157fff6e4590479` |
| `sample-report.pdf`             |   1 196 B | `1f0b8dc327c1b5613caa48dc818e81e83a7328425afb184fd0d2f89e37e47021` |
| `SHA256SUMS`                    |    180 B  | (the two hashes above, sha256sum-compatible format) |

`sample-report.pdf` was produced by `POST /api/reports/generate` against the
running checkpoint build with body
`{"testId":"checkpoint","testName":"Damp Heat","standard":"IEC 61215-2 MQT 13","operator":"Agnipariksha","result":"PASS"}`.

`frontend-bundle-static.tar.gz` is the deterministic `frontend/.next/static`
tree produced by `npx next build` (tar flags: `--sort=name --owner=0
--group=0 --numeric-owner --mtime='UTC 1970-01-01'`).

## Rollback

```bash
git fetch --tags origin
git checkout v0.9.0-checkpoint-2026-05-12
bash deploy.sh
```
