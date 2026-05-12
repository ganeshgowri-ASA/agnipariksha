# Agnipariksha — lessons log

One line per merge. Pulled into `docs/NOTION_APPEND_BODY.md` at release time.

2026-05-12 PR#31 feat(overview): V2-S8 360° overview dashboard + V2 feature flags — root path moved to /overview redirect, broke smoke.sh wait_200 which only accepted literal 200; fixed by adding -L to follow the 307.
2026-05-12 PR#33 chore(release): bump frontend to 1.0.1 for v0.9.1-overview-360 — patch bump only; local annotated tag v0.9.1-overview-360 created at the PR#31 merge SHA, push to refs/tags/* blocked by remote HTTP 403 so tag is not yet on origin.
2026-05-12 PR#34 fix(deploy): follow redirects in wait_http_200 — same 307-vs-200 root cause as PR#31's smoke.sh fix, surfaced when deploy.sh ran for the first time post-overview merge; fixed by adding -L to deploy.sh's curl helper.
2026-05-12 PR#26 feat(backend): pluggable hardware transport abstraction (V2-S1) — rebased on main; one conflict in frontend/app/page.tsx (PR #31 had moved the dashboard); resolved by keeping / as redirect and porting DevicePills into /dashboard/page.tsx. Local gate green (40 pytest, tsc, next build, smoke 11/12 with /dashboard warming to 200). New /api/devices returns 3 devices incl. ITECH PV6000 @192.168.200.100:30000.
