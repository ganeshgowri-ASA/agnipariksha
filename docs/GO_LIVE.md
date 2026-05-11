# Agnipariksha — Go-Live Checklist

Run this checklist **end-to-end before** promoting any build to a production
ITECH PV6000 test station. Sign off each section and attach the completed
file (or a screenshot) to the release tag.

> Use the checkboxes — every box must be ticked, with no exceptions, before
> the system is cleared for live test operation.

---

## 0. Release Metadata

- [ ] Release tag: `v_____._____._____`
- [ ] Build artefact (web): `__________________________________________`
- [ ] Build artefact (Tauri exe/dmg/deb): `_______________________________`
- [ ] Backend commit SHA: `_______________________`
- [ ] Frontend commit SHA: `_______________________`
- [ ] Operator on duty: `__________________________`
- [ ] Date / time (UTC): `__________________________`

---

## 1. Source & CI

- [ ] All feature PRs merged into `main` via squash-merge.
- [ ] CI on `main` is **green** for the tagged commit (`backend`, `frontend`, `e2e` jobs).
- [ ] No `TODO(blocker)` or `FIXME(blocker)` in the diff (`git grep -n "blocker"` is empty).
- [ ] Release notes drafted in `docs/RELEASE_NOTES.md` (or GitHub release).

---

## 2. Environment

### 2.1 Tooling on the workstation
- [ ] Node.js LTS installed (`node --version` → v20.x or v22.x).
- [ ] npm 10+ installed (`npm --version`).
- [ ] Python 3.11+ installed; `py --version` works in PowerShell.
- [ ] Rust toolchain installed if shipping the Tauri build.

### 2.2 Configuration
- [ ] `.env.local` present in `frontend/` with:
  - `ANTHROPIC_API_KEY=…` (production key)
  - `NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws/live`
- [ ] No development keys, no test stubs left in `frontend/.env.local` or `backend/.env`.

---

## 3. ITECH PV6000 Device

- [ ] Device powered on and self-test passed (no front-panel error code).
- [ ] LAN cable seated; link LED solid green.
- [ ] Device IP matches `backend/scpi_driver.py` (default `192.168.200.100:30000`).
- [ ] PowerShell reachability check passes:
  ```powershell
  powershell -Command "Test-NetConnection 192.168.200.100 -Port 30000"
  ```
  → `TcpTestSucceeded : True`.
- [ ] `*IDN?` returns the expected model + firmware string (`ITECH,PV6000,…`).
- [ ] Last calibration date is within manufacturer interval — sticker checked.

---

## 4. Safety & Interlocks

- [ ] DUT (device under test) is in the isolation chamber; door closed.
- [ ] E-stop reachable from the operator station; tested and reset.
- [ ] Chamber temperature alarm thresholds configured per IEC standard for the test.
- [ ] Reverse-current fuse rating verified for RCO test (135 % of rated fuse).
- [ ] Ground bonding resistance verified < 0.1 Ω for GCT test.
- [ ] Operator wearing PPE per local SOP.

---

## 5. Backend smoke

- [ ] `python main.py` starts cleanly; `/docs` reachable on `http://localhost:8000/docs`.
- [ ] `GET /api/device/status` returns `connected: true, model: "ITECH PV6000", …`.
- [ ] WebSocket `/ws/live` accepts a connection and streams a heartbeat within 2 s.
- [ ] `pytest -q` is green against the production branch.

---

## 6. Frontend smoke

- [ ] `npm run build` exits 0.
- [ ] App loads on `http://localhost:3000` in <3 s.
- [ ] Top-right device-status badge is **green** (connected) — not "Demo".
- [ ] All six test tabs render without console errors (TC, HF, LeTID, BDT, RCO, GCT).
- [ ] Demo mode toggle works (switches the data source without reload).
- [ ] Playwright smoke (`cd tests && npm test`) is green.

---

## 7. End-to-end dry run (per test)

For each of TC / HF / LeTID / BDT / RCO / GCT:

- [ ] Configure params per the IEC limits documented in `docs/test-standards.md`.
- [ ] Start a short dry run (≤ 60 s) with the DUT replaced by a calibrated load.
- [ ] Live V/I/P chart updates at the documented sample rate.
- [ ] Pass/fail logic resolves correctly against an injected failure scenario.
- [ ] Generated PDF and DOCX reports open cleanly and contain all sample rows.
- [ ] Test record is persisted (`backend/database.py` SQLite row appears).

---

## 8. AI MCP layer

- [ ] `/api/chat` returns a non-empty response to "summarise the last TC run".
- [ ] Anomaly detection flags a known-bad LeTID curve from the demo dataset.
- [ ] SCPI synthesis tool produces a valid SCPI string for "set output current to Isc".
- [ ] Production `ANTHROPIC_API_KEY` is loaded — not a dev sandbox key.

---

## 9. Observability & Backups

- [ ] Backend logs are rotating to `backend/logs/` (or stdout captured by service manager).
- [ ] SQLite database file path is on a backed-up volume.
- [ ] A baseline DB snapshot has been taken and stored off-machine.
- [ ] On-call contact list updated for the release window.

---

## 10. Rollback Plan

- [ ] Previous Tauri installer/web bundle archived and reachable in ≤ 5 min.
- [ ] DB migration is reversible (or none in this release).
- [ ] Documented rollback command tested:
  ```bash
  git checkout v<previous>
  bash scripts/start_dev.sh
  ```
- [ ] Hardware power-off + re-home procedure verified.

---

## 11. Sign-off

| Role                | Name                | Signature           | Date |
|---------------------|---------------------|---------------------|------|
| Test Engineer       |                     |                     |      |
| Software Lead       |                     |                     |      |
| Safety Officer      |                     |                     |      |
| Quality / Compliance|                     |                     |      |

> Once all boxes are ticked and all signatures captured, the build is
> cleared for live operation. Archive this completed checklist in
> `docs/releases/<tag>/GO_LIVE.md`.
