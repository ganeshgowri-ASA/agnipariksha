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
