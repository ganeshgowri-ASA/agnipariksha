# First-Energization Bench Protocol

Operator-facing checklist for the first time the Agnipariksha bench is
brought up against a live ITECH PV6000 and a real PV module. Run through
every step in order. Do not skip ahead; abort and escalate on any
unexpected reading.

Required equipment: safety glasses, insulated gloves, multimeter, the
module under test (MUT), the test bench laptop, and a witness operator.

## 9-Step Checklist

1. **Pre-flight (physical).** Confirm the PV6000 mains lock-out is engaged,
   no module is connected to the output terminals, the bench area is dry,
   and safety glasses are on. Both operators sign the bench log.

2. **Run `scripts/preflight-bench.sh`.** The script is READ-ONLY. It
   verifies TCP reachability, `*IDN?` returns an ITECH identification
   string, and `OUTP?` returns `0`. If it prints the red `DANGER` banner,
   stop immediately and remediate before touching the bench.

3. **Connect the module under test.** Power down the PV6000, attach the
   MUT to the output terminals, and verify polarity with a multimeter
   before re-enabling the supply. Tighten lugs to spec; photograph the
   wiring.

4. **Run the UI's Basic Check sub-tab.** In the Agnipariksha web UI,
   open the Basic Check tab and start the run. Wait until the status
   tower shows all-green (V sense, I sense, comms, interlock, temp).

5. **Confirm Basic Check pass via API.** Hit `/api/basic-check/status`
   and confirm the response contains the active Module ID and a
   `status: "pass"` payload. Save the response JSON to the operator log.

6. **Verify `DEMO_MODE=false` in `/api/health`.** For a live energization
   the backend must report `demo_mode: false`. If it reports `true`,
   stop — the bench is still in demo and would not be driving real
   hardware. Restart the backend with the production env file and retry.

7. **Start the target test in the UI.** Pick the IEC test for this MUT
   (TC, HF, LeTID, BDT, RCO, or GCT). Watch the first 30 seconds: V/I
   must track the test profile's nominal trajectory and stay inside the
   per-test soft limits. Have the witness operator log time, V, I.

8. **On any anomaly: E-STOP.** Press the physical E-STOP button on the
   bench AND issue the software stop via
   `POST /api/tests/{id}/control` with `{ "action": "emergency_stop" }`.
   Wait until the UI status tower shows `ARMED=false` and the PV6000
   front panel confirms output off.

9. **Log results.** Record the CSV results path emitted by the backend
   (under `data/results/`) and the MUT's Module ID in the operator log
   alongside the witness operator's initials and timestamp. File the
   page with the bench logbook.

## Notes

- The preflight script in step 2 will NEVER issue `OUTP ON`, `VOLT`, or
  `CURR` set commands. It is purely diagnostic.
- Steps 5 and 6 are the only safe gates before energization. Do not
  proceed past step 6 if either gate fails.
- Keep the witness operator in the room from step 3 through step 9.
