# Agnipariksha — Product Requirements Document
**Shreshtata Power Supplies | v1.0 | May 2026**

## Executive Summary
Agnipariksha is a full-stack PV module reliability test automation platform that programs the ITECH IT6000C DC Power Supply to execute 6 IEC-standardized tests, providing real-time monitoring, AI-powered analysis, and automated report generation.

## Hardware Platform
- **Instrument**: ITECH IT6000C Series (IT6018C-500-30)
- **Software**: IT9000 PV6000 v1.0.3.3
- **Connection**: LAN/TCP at 192.168.200.100:30000 (SCPI over raw TCP)
- **Communication**: Ethernet (standard) | RS-232, GPIB (optional)

## Test Requirements

### 1. Thermal Cycling (TC) — IEC 61215-2 MQT 11
- Cycles: 200 (qualification) | 50 (prequalification)
- Temperature: -40°C to +85°C
- Current injection: Isc at Voc during hot phase
- Dwell: 10 minutes minimum at each extreme

### 2. Humidity Freeze (HF) — IEC 61215-2 MQT 12
- Cycles: 10
- Hot phase: +85°C / 85% RH for 20 hours
- Cold phase: -40°C for 20 hours
- Current injection: Isc at Voc during hot phase only

### 3. LeTID — IEC TS 63342:2022
- Temperature: 75°C ± 3°C
- Dark current: Idark = Isc − Imp
- Duration: 162 hours minimum
- Measurement: Every 2 hours (Pmax via IV curve)
- Pass: Pmax degradation < 2% from initial

### 4. Bypass Diode Thermal (BDT) — IEC 62979:2017
- Current: 1.35 × Isc
- Duration: 1 hour continuous
- Monitor: Vf < 0.7V per diode (thermal runaway threshold)
- Pass: No thermal runaway, structural integrity

### 5. Reverse Current Overload (RCO) — IEC 61730-2 MST 26
- Current: 1.35 × maximum overcurrent protection rating
- Monitor: Fuse activation, module voltage collapse
- Pass: No fire, no explosion, fuse activates safely

### 6. Ground Continuity (GCT) — IEC 61730-2 MST 13
- Test current: 25A
- Voltage limit: 2.5V
- Pass criterion: R < 0.1 Ω (frame to earth)
- Duration: Until stable (< 30 seconds)

## Non-Functional Requirements
- E-STOP response: < 50ms from button click to OUTP OFF
- Data sampling: 2 Hz minimum during active tests
- Report generation: < 10 seconds for full session
- Demo mode: All 6 tests functional without hardware
- Installer: < 15 MB .exe for Windows 10/11

## AI MCP Capabilities
1. `get_live_measurements` — Real-time V/I/P from instrument
2. `predict_letid_outcome` — LeTID degradation forecast
3. `detect_anomalies` — Statistical anomaly detection
4. `query_test_data` — Natural language → TimescaleDB SQL
5. `generate_test_report` — Trigger Word/PDF generation
6. `get_test_history` — Past session lookup

---

## PRD v2.0 — Enterprise Scope (2026-05-12)

### 1) HARDWARE CONTROL LAYER
- SCPI over TCP (primary) to ITECH PV6000 at 192.168.200.100:30000 via existing async driver.
- TCP/IP socket protocol parity for non-SCPI devices (raw framed messages, configurable per-device).
- Pluggable transport interface: SCPI-TCP, SCPI-USBTMC, Modbus-TCP, Modbus-RTU, raw TCP, RS-232. One abstract class `Transport` with `connect/send/recv/close` and per-device YAML descriptor under `backend/app/devices/`.
- Device registry with health checks, auto-reconnect, command lock, queued ops, audit log.
- Mode toggle: LIVE / DEMO per device; UI pill reflects state.

### 2) DATABASE
- Postgres in prod, SQLite for dev/desktop. SQLModel/Alembic migrations.
- Schema: Module, TestRun, TelemetrySample (TimescaleDB hypertable when Postgres), Report, Operator, Equipment, SparePart, MaintenanceTicket, ComplaintTicket, AIThread, AuditLog, BarcodeScan, Schedule (Gantt slot).
- Backups: nightly `pg_dump` to `data/backups/` with 14-day retention.
- `DATABASE_URL` via `.env`; `.env.example` updated.

### 3) REPORT ENGINE (PDF + DOCX)
- User-selectable sections via checkboxes on Report tab: header/brand, test description, IEC clause, parameters, graphs (multi-select Voltage, Current, Power, Temperature, RH, Tj, Vf-vs-T), data tables (raw / decimated / summary), pass/fail vs IEC, raw data path, error log, troubleshooting notes, signature block, photos.
- Graphs via matplotlib server-side; tables via reportlab/python-docx; consistent Shreshtata theme; QR code at footer linking to run URL.

### 4) RELIABILITY ANALYTICS
- MTBF, MTTR, availability per equipment from MaintenanceTicket history.
- Predictive maintenance: rolling Weibull fit on equipment failure intervals + simple threshold alerts on telemetry drift; surface 'risk score' and 'next service due' per equipment card.
- Spare parts inventory: `part_no`, `qty_on_hand`, `reorder_level`, `supplier`, `lead_time`, `last_used_at`; auto-create reorder ticket when `qty <= reorder_level`.

### 5) TICKETING
- Complaint tickets and maintenance tickets share a base model; states: `open`, `in_progress`, `waiting_part`, `resolved`, `closed`; SLA timers; assignee; attachments; linked equipment/module/run.
- 'Raise ticket' button on every error toast and on Report tab.

### 6) PROJECT MANAGEMENT / GANTT
- Equipment scheduling view: weekly + monthly Gantt of test slots per chamber/PSU; conflict detection; drag-to-reschedule; export ICS.
- 'Next available slot' computation per equipment exposed via `/api/scheduler/next-slot`.

### 7) BARCODE / QR
- Camera + USB HID scanner support. Scan Module ID, Equipment ID, Spare Part QR → auto-resolve and open record.
- `/modules/<id>` and `/equipment/<id>` printable QR labels (reportlab).

### 8) WEBSOCKET + REMOTE MONITORING
- `/ws/telemetry` already exists; add `/ws/events` (test state, alarms, tickets).
- Reverse-tunnel option (Cloudflare Tunnel) documented for read-only remote access; JWT auth for `/ws/*` and `/api/*`.
- Push notifications via Web Push (VAPID) to mobile/desktop browsers; opt-in per operator.

### 9) MOBILE-RESPONSIVE
- Audit every page at 360×640 and 768×1024; ensure tabs collapse to a 'More' menu; charts swap to stacked single-column layout; AI panel becomes bottom-sheet on mobile.

### 10) 360-DEGREE OVERVIEW DASHBOARD
- Single page at `/overview` showing: KPIs (tests today, pass rate, mean run time, MTBF), equipment health grid, upcoming schedule mini-gantt, open tickets, spare-parts low-stock, AI 'what changed today' summary.

### 11) NON-FUNCTIONAL
- Incremental rollout: each item on its own feature branch, squash-merge to main, version bump v0.9.x → v1.0.0 when all green. Rollback tag `v0.9.0-checkpoint-2026-05-12` stays valid.
- Zero app downtime: schema changes via Alembic forward-compatible migrations; UI features behind feature flags (`NEXT_PUBLIC_FF_*`).
- All secrets via `.env`; no client-side keys.
