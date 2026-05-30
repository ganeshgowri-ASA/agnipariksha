# Agnipariksha Operator Runbook

PV module reliability test station — IEC 61215 / 61730 / 62804 / 63342.

This is the canonical day-to-day operations doc. The Notion runbook
(35d3f809bd1f80e58af8c043cbe1d43e) carries decision history; this file
carries the **commands that actually work**.

---

## 1. Production URL

| What | Where |
|---|---|
| Live app | https://agnipariksha.vercel.app |
| Repo | https://github.com/ganeshgowri-ASA/agnipariksha |
| Notion (history) | https://app.notion.com/p/Agnipariksha-Reproducible-Deploy-Runbook-35d3f809bd1f80e58af8c043cbe1d43e |
| Rollback anchor tag | `pre-sweep-2026-05-28` @ `809ac20` |

The Vercel app auto-deploys `main`. No manual deploy step is required
for the frontend.

---

## 2. Bench setup — Windows PowerShell

Tested on `C:\Users\Administrator\agnipariksha` (or
`C:\Users\Administrator\Documents\agnipariksha` — whichever your clone
lives at). Run each block in a fresh PowerShell window unless the
header says otherwise.

### 2.1 One-time setup

```powershell
# Sync the repo
cd C:\Users\Administrator\Documents\agnipariksha
git fetch origin --tags --prune
git checkout main
git pull --ff-only origin main

# Backend deps (Python 3.11 or 3.12)
cd backend
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
cd ..

# Frontend deps
cd frontend
npm install            # or: pnpm install + pnpm approve-builds for esbuild/msw
cd ..
```

### 2.2 Kill any stale processes (do this BEFORE every start)

```powershell
# Free :8000 (backend) and :3000 (frontend) if a previous run hung.
Get-NetTCPConnection -LocalPort 8000,3000 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
```

### 2.3 Start backend + frontend (two windows)

**Window A — backend (uvicorn):**

```powershell
cd C:\Users\Administrator\Documents\agnipariksha\backend
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

The first request will create `data/runs/` and initialise the SQLite
DB. Watch the log for `Uvicorn running on http://127.0.0.1:8000`.

**Window B — frontend (Next.js):**

```powershell
cd C:\Users\Administrator\Documents\agnipariksha\frontend
$env:NEXT_PUBLIC_BACKEND_HTTP_URL = "http://127.0.0.1:8000"
$env:BACKEND_HTTP_URL = "http://127.0.0.1:8000"
npm run dev
```

Open http://localhost:3000/dashboard . Use **Ctrl+Shift+R** the first
time to bypass any stale browser cache.

### 2.4 Quick sanity tests

```powershell
# Backend health
Invoke-RestMethod http://127.0.0.1:8000/api/health | Format-List

# Device registry (PSU/chamber/DMM YAML manifests)
Invoke-RestMethod http://127.0.0.1:8000/api/devices | ConvertTo-Json -Depth 5

# SCPI round-trip in DEMO mode
Invoke-RestMethod "http://127.0.0.1:8000/api/scpi/query?cmd=*IDN?"

# Generate an IEC PDF from a sample session payload
$body = @{
  id            = "TC-smoke-$(Get-Date -Format yyyyMMddHHmmss)"
  testType      = "thermal_cycling"
  iecClause     = "MQT 11"
  startTime     = [int64](Get-Date -UFormat %s) * 1000
  status        = "pass"
  result        = "PASS"
  operatorName  = "Mounika Mandru"
  customerName  = "Reliance Industries Limited"
  companyName   = "ASA Test Labs"
  equipmentId   = "ITECH PV6000 / ESPEC SH-242 / Keysight 34465A"
  moduleSerial  = "MOD-77001"
  readings      = @()
  kpis          = @{ completedCycles = 200; result = "PASS" }
} | ConvertTo-Json
Invoke-WebRequest -Method POST -Uri http://127.0.0.1:8000/api/reports/generate `
  -ContentType 'application/json' -Body $body -OutFile sample-report.pdf
Start-Process sample-report.pdf
```

---

## 3. Connecting the real PV6000 PSU

The bench PSU lives at **192.168.200.100:30000** (SCPI raw socket).
The DEMO simulator is the default — flip to LIVE per device:

### 3.1 From the browser

1. Open http://localhost:3000/dashboard
2. The **DevicePills** strip in the AppHeader shows each device with a
   yellow chip = DEMO, green chip = LIVE.
3. Click the PSU pill → confirm the demo/live toggle in the popover.
   On the first LIVE switch the backend emits a probe `*IDN?` over TCP
   and updates the pill to green if the PSU answers within 1.5 s.

### 3.2 From PowerShell (no browser needed)

```powershell
# Confirm the device is reachable
Test-NetConnection 192.168.200.100 -Port 30000   # TcpTestSucceeded : True

# Switch the PSU to LIVE
$body = '{"mode":"live"}'
Invoke-RestMethod -Method POST -ContentType 'application/json' `
  -Uri http://127.0.0.1:8000/api/devices/itech_pv6000/mode -Body $body

# Force an immediate liveness probe
Invoke-RestMethod -Method POST `
  -Uri http://127.0.0.1:8000/api/devices/itech_pv6000/ping

# Inspect the audit log (every SCPI write is logged)
Invoke-RestMethod http://127.0.0.1:8000/api/devices/audit | Format-List
```

> **Safety:** LIVE mode allows `SOUR:`/`OUTP` writes to the real PSU.
> Before flipping LIVE for the first time: someone at the bench,
> E-stop in reach, DEMO/LIVE toggle re-tested green, Issue #96 gate
> verified intact (`IV PSU scope` router does not bypass the gate).

---

## 4. Common breakages and fixes

| Symptom | Fix |
|---|---|
| Frontend Analysis pane blank after a `git pull` | Bypass cache: **Ctrl+Shift+R** in browser, OR restart `npm run dev` (Next hot-reload sometimes misses new `features/*` folders) |
| `pytest` fails with `concurrent.futures._base.CancelledError` in `test_ws_lifecycle.py` | Known intermittent. CI now auto-reruns up to 2x (PR #126). Locally just re-run. |
| `uvicorn: command not found` | Use `python -m uvicorn main:app` — bare `uvicorn` doesn't exist on Windows Python by default |
| Reports say "NA" for Operator/Customer | Open AppHeader → **Operator Picker** chip (next to the "DEMO" badge) → fill the 6 fields → run the test |
| `/overview` returns 500 with manifest ENOENT (#97) | `Remove-Item -Recurse -Force .next; npm run dev` |
| `pnpm` complains about unbuilt esbuild/msw | `corepack enable; pnpm approve-builds` (you only need to do this once per box) |
| Vercel preview shows stale UI | Wait ~2 min after merge; if still stale, force a redeploy from the Vercel dashboard |

---

## 5. Test report flow (PR #129 backend ReportLab)

```
Operator clicks "Generate PDF" on a tab's Report sub-tab
        │
        ▼  TestSession (stamped with operator/customer/equipment by PR #128)
POST /api/reports/generate  ── frontend Next.js route
        │
        ▼  forwards to ${BACKEND_HTTP_URL}/api/reports/generate
POST /api/reports/generate  ── backend FastAPI route
        │
        ▼  build_iec_report(payload)  in backend/reports/builders/iec_report.py
ReportLab pipeline:
   Cover (operator + customer + equipment + result)
   §1 Setpoints
   §2 KPIs + IEC verdict text
   §3 matplotlib time-series chart
   §4 Raw CSV appendix + SHA-256
        │
        ▼ application/pdf, multi-page, signable/archivable
Browser receives `attachment; filename="<session-id>-iec-report.pdf"`
```

Fallback: if `BACKEND_HTTP_URL` env is unset OR the backend doesn't
answer within 8 s, the Vercel route returns a tiny text-only PDF and
sets `X-Report-Source: frontend-fallback` so the operator knows.

---

## 6. Test status by tab (IEC compliance)

| Tab | Standard | Analysis pane | Schematic | Stamps reports |
|---|---|---|---|---|
| TC | IEC 61215-2 MQT 11 | ✅ live | ✅ IEC | ✅ |
| HF | IEC 61215-2 MQT 12 | ✅ live | ✅ IEC | ✅ |
| LeTID | IEC TS 63342:2022 | ✅ live | placeholder | ✅ |
| BDT | IEC 62979:2017 | ✅ live (PR #87) | placeholder | ✅ |
| GCT | IEC 61730-2 MST 13 | ✅ live (PR #112) | placeholder | ✅ |
| EB | IEC 61730-2 MST 11 | template only | placeholder | ✅ |
| DH | IEC 61215-2 MQT 13 | template only | placeholder | ✅ |
| RCO | IEC 61730-2 MST 26 | template only | placeholder | ✅ |
| PID | IEC TS 62804-1 | template only | placeholder | ✅ |
| EL | IEC TS 60904-13 | template only | placeholder | ✅ |
| IIR | IEC TS 60904-12 | template only | placeholder | — (no session lifecycle) |

Issues #117 #119 #120 #121 track the remaining four Analysis-pane
implementations (RCOT, EL, IIR, PID). Each one is one focused session
of work applying the TC template (`frontend/features/<tab>/analysis/`).

---

## 7. Devices + calibration framework (planned, #131 #132)

A dedicated Devices admin tab + calibration store is spec'd in GitHub
issue #131. The .exe packaging plan is in #132. Until those land,
device definitions live in YAML at `backend/app/devices/*.yaml` —
adding a new PSU is a YAML edit + service restart.

---

## 8. Rollback

If anything since `pre-sweep-2026-05-28` is broken:

```powershell
# Soft rollback of one PR (preferred)
git revert <merge-sha>            # see Notion runbook for SHA list
git push origin <revert-branch>   # open PR, squash-merge

# Hard rollback (only with owner approval — see Notion §10 Level B)
git fetch --tags origin
git checkout main
git reset --hard pre-sweep-2026-05-28
git push --force-with-lease origin main
```

---

_Last updated 2026-05-30. Owners: Ganesh Gowri (Mitsui), Mounika Mandru.
Source of truth for command lines. For decision history see the Notion
runbook._
