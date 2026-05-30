"""DEMO report fixtures.

A "report run" aggregates several per-test IEC verdicts for one module into
one IEC document. Verdicts come from the real
``backend.app.analysis.iec_pass_fail`` helpers, so the report consumes the
exact ``AnalysisResult`` / ``Verdict`` shape Tab 4 emits once merged — only
the inputs are canned. ``get_run`` returns ``None`` for unknown ids.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Optional

try:
    from ..analysis import iec_pass_fail as ipf
except ImportError:  # pragma: no cover - script-mode fallback
    from app.analysis import iec_pass_fail as ipf  # type: ignore[no-redef]

from . import sections as sec


@dataclass(frozen=True)
class TelemetryPoint:
    t_min: float
    chamber_t_c: float
    chamber_rh_pct: float
    module_i_a: float
    module_v_v: float


@dataclass(frozen=True)
class TestBlock:
    key: str
    name: str
    result: ipf.AnalysisResult
    unit: str
    clause_text: str
    raw_csv: str
    evidence: List[str]
    window: List[TelemetryPoint]

    @property
    def clause(self) -> str:
        return self.result.clause

    @property
    def verdict(self) -> str:
        # Spec pill wording: INSUFFICIENT_DATA surfaces as INCONCLUSIVE.
        v = self.result.verdict
        return "INCONCLUSIVE" if v is ipf.Verdict.INSUFFICIENT_DATA else v.value


@dataclass(frozen=True)
class ReportRun:
    run_id: str
    module_id: str
    test_id: str
    standard: str
    operator: str
    reviewer: str
    timestamp_ist: str
    tests: List[TestBlock]
    # Per-test extended sections — each ``None`` when the test was not part
    # of the run. A populated DB would fill these via a loader; DEMO uses
    # the deterministic generators in ``sections``.
    tc: Optional["sec.TCSection"] = None
    hf: Optional["sec.HFSection"] = None
    pid: Optional["sec.PIDSection"] = None
    letid: Optional["sec.LeTIDSection"] = None
    rco: Optional["sec.RCOSection"] = None
    gct: Optional["sec.GCTSection"] = None
    el: Optional["sec.ELSection"] = None
    iir: Optional["sec.IIRSection"] = None
    powergen: Optional["sec.PowerGenSection"] = None

    @property
    def overall(self) -> str:
        verdicts = {t.verdict for t in self.tests}
        if "FAIL" in verdicts:
            return "FAIL"
        return "INCONCLUSIVE" if "INCONCLUSIVE" in verdicts else "PASS"


def _window(n: int, t0: float, rh0: float, i0: float, v0: float, drift: float) -> List[TelemetryPoint]:
    """Deterministic synthetic telemetry window (no RNG) for overlay graphs."""
    span = max(n - 1, 1)
    out: List[TelemetryPoint] = []
    for k in range(n):
        f = k / span
        out.append(TelemetryPoint(
            round(f * 60.0, 2),
            round(t0 + 22.0 * math.sin(f * 2 * math.pi), 2),
            round(rh0 + 5.0 * math.cos(f * 2 * math.pi), 2),
            round(i0 * (1 + 0.02 * math.sin(f * 4 * math.pi)), 3),
            round(v0 * (1 - drift * f), 3),
        ))
    return out


def _demo_run() -> ReportRun:
    """Single golden DEMO run exercising PASS / FAIL / INCONCLUSIVE."""
    gct_rd = [ipf.Reading(timestamp_ms=i * 500, voltage=2.0, current=25.0, power=50.0) for i in range(6)]
    blocks = [
        TestBlock("tc", "Thermal Cycling", ipf.pmax_delta_verdict(305.0, 298.0, clause="IEC 61215-2 MQT 11"), "%",
                  "IEC 61215-2 MQT 11 — 200 thermal cycles between -40 °C and +85 °C; ΔPmax must stay within -5 % of the pre-test value.",
                  "data/runs/DEMO-RUN-001/tc.csv", ["evidence/tc_chamber_setpoint.png", "evidence/tc_iv_curve.png"],
                  _window(48, 22.0, 35.0, 9.21, 41.2, 0.012)),
        TestBlock("hf", "Humidity Freeze", ipf.pmax_delta_verdict(305.0, 286.0, clause="IEC 61215-2 MQT 12"), "%",
                  "IEC 61215-2 MQT 12 — 10 humidity-freeze cycles (+85 °C/85 %RH to -40 °C); ΔPmax must stay within -5 % (Gate-2 criterion).",
                  "data/runs/DEMO-RUN-001/hf.csv", ["evidence/hf_delam_back.png"],
                  _window(48, 24.0, 85.0, 9.18, 41.0, 0.062)),
        TestBlock("letid", "LeTID", ipf.letid_verdict(312.0, 309.0), "%",
                  "IEC TS 63342 — Isc-Imp forward current at +75 °C for 162 h; Pmax loss must stay within -2 %.",
                  "data/runs/DEMO-RUN-001/letid.csv", ["evidence/letid_voc_trend.png"],
                  _window(48, 75.0, 20.0, 4.65, 39.8, 0.010)),
        TestBlock("gct", "Ground Continuity", ipf.ground_continuity_verdict(gct_rd), "Ω",
                  "IEC 61730-2 MST 13 — drive 25 A between accessible conductive parts; junction resistance must remain ≤ 0.1 Ω.",
                  "data/runs/DEMO-RUN-001/gct.csv", ["evidence/gct_probe_points.png"],
                  _window(24, 23.0, 30.0, 25.0, 2.0, 0.0)),
        TestBlock("bdt", "Bypass Diode", ipf.bypass_diode_verdict([]), "°C",
                  "IEC 62979 — force 1.35×Isc through the bypass-diode network for 1 h; junction temperature must remain ≤ 128 °C.",
                  "data/runs/DEMO-RUN-001/bdt.csv", [],
                  _window(36, 75.0, 18.0, 12.4, 0.62, 0.0)),
    ]
    return ReportRun(
        run_id="DEMO-RUN-001", module_id="PV-MOD-001", test_id="CAMPAIGN-2026-0042",
        standard="IEC 61215 / IEC 61730 / IEC TS 63342",
        operator="A. Nahata", reviewer="", timestamp_ist="2026-05-28 14:32:10 IST",
        tests=blocks,
        tc=sec.gen_tc(),
        hf=sec.gen_hf(),
        pid=sec.gen_pid(),
        letid=sec.gen_letid(),
        rco=sec.gen_rco(),
        gct=sec.gen_gct(),
        el=sec.gen_el(),
        iir=sec.gen_iir(),
        powergen=sec.gen_powergen(),
    )


_RUNS = {r.run_id: r for r in (_demo_run(),)}


def list_runs() -> List[ReportRun]:
    return list(_RUNS.values())


def get_run(run_id: str) -> Optional[ReportRun]:
    return _RUNS.get(run_id)
