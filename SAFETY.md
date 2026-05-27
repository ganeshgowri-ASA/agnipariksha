# Safety Gates

Operational safety rules for the Agnipariksha PV reliability test station.
Tests that can damage a module, the station, or the operator are gated here.

## RCOT — Reverse Current Overload Test (IEC 61730-2:2016 MST 26)

RCOT reverse-biases a PV module at **1.35× its maximum series fuse rating**.
A faulty module or mis-wire can cause cell heating, melting, or **fire** — one
of the most hazardous tests in the suite.

### LIVE is HARD-BLOCKED in code

Only `DEMO_MODE` runs today. `backend/app/rcot.py` `run(demo=False)` raises
`NotImplementedError`, and the frontend shows a `LIVE BLOCKED` badge:

> LIVE RCOT BLOCKED - requires verified PSU reverse-polarity driver, K-type
> thermocouples, owner physically at bench, and audited E-stop. Contact owner.

### Owner-at-bench gate (required before LIVE is ever unblocked)

A LIVE RCOT run must NOT be enabled until ALL of these hold:

1. **Owner physically at the bench** for the entire run — not remote.
2. A **verified reverse-polarity PSU driver** (reviewed + bench-tested).
3. **K-type thermocouples** bonded to the module for real Tj measurement.
4. An **audited, wired E-stop** that cuts output independently of software.
5. Automatic abort armed at the **Tj threshold (default 200 °C)**.

Even in DEMO, the operator must tick **owner-at-bench** and **E-stop-wired**
before Start — `validate_start()` enforces this as training discipline.

### Verdict

PASS only if there was **no thermal abort** AND the operator confirms
**"no flame, melting, cracking observed"**. The verdict is `UNKNOWN` until that
manual checkbox is set; a thermal abort is a conclusive `FAIL`.
