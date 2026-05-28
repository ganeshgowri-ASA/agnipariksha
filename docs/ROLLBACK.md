# Rollback Checkpoint — pre-PR #62 (Issue #96: SCPI-leak-in-DEMO)

## Checkpoint anchor
| Item | Value |
|------|-------|
| Canonical tag | `pre-pr62-rebase-2026-05-27` |
| Backup branch (on origin) | `checkpoint/pre-pr62-rebase-2026-05-27` |
| Commit | `fe5b74d` — *Merge pull request #88 (feat/letid-analysis-regeneration)* |
| Date | 2026-05-28 |

## What `main` looked like at the checkpoint
`fe5b74d` is `main` immediately **before** the PR #62 live-PSU-gate /
Basic-Check energization gate (Issue #96) lands. It already includes every PR
through #88: LeTID & BDT analysis, the PID/EL/EB/IIR tabs, IV import,
nameplate panel, and schematic viewer.

## Restore (DESTRUCTIVE — read the warning first)
```sh
git checkout main
git reset --hard pre-pr62-rebase-2026-05-27   # or: origin/checkpoint/pre-pr62-rebase-2026-05-27
git push --force-with-lease origin main
```

## Warning
- **Revert or close PR #62 BEFORE invoking rollback.** If #62 has merged, a hard
  reset drops it from `main` but leaves the PR/branch dangling — close it and
  delete its branch so it cannot be re-merged by accident.
- Force-pushing `main` rewrites shared history; coordinate with anyone who
  pulled `main` after the checkpoint.
- This rolls back `main` only — feature branches and tags are left intact.

## Note on the tag
The CI sandbox agent could not push the annotated tag (the git proxy returns
HTTP 403 on the `refs/tags/*` namespace), so the `checkpoint/...` branch is the
working origin-side anchor. To add the real tag from a bench with full rights:
```sh
git tag -a pre-pr62-rebase-2026-05-27 fe5b74d -m "Rollback checkpoint before PR #62 (Issue #96)"
git push origin pre-pr62-rebase-2026-05-27
```
