"""DEMO report fixtures.

A "report run" aggregates several per-test IEC verdicts for one module into
a single IEC-formatted document. The verdicts are produced by the real
``backend.app.analysis.iec_pass_fail`` helpers so the report consumes the
exact ``AnalysisResult`` / ``Verdict`` shape that Tab 4 emits once merged —
only the *inputs* here are canned.

DEMO-only: no DB, no hardware. ``get_run`` returns ``None`` for unknown ids
so the router can 404.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Optional

try:
    from ..analysis import iec_pass_fail as ipf
except ImportError:  # pragma: no cover - script-mode fallback
    from app.analysis import iec_pass_fail as ipf  # type: ignore[no-redef]


@dataclass(frozen=True)
class TelemetryPoint:
    t_min: float
    chamber_t_c: float
    chamber_rh_pct: float
    module_i_a: float
    module_v_v: float


@dataclass(frozen=True)
class TestBlock:
    """One IEC test within a report: its verdict + evidence + telemetry."""

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
        if self.result.verdict is ipf.Verdict.INSUFFICIENT_DATA:
            return "INCONCLUSIVE"
        return self.result.verdict.value

    def _fmt(self, v: Optional[float]) -> str:
        return "—" if v is None else f"{v:.3f} {self.unit}".strip()

    @property
    def measured(self) -> str:
        return self._fmt(self.result.metric)

    @property
    def threshold(self) -> str:
        return self._fmt(self.result.threshold)

    @property
    def margin(self) -> str:
        if self.result.metric is None:
            return "—"
        return self._fmt(self.result.metric - self.result.threshold)


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

    @property
    def overall(self) -> str:
        verdicts = {t.verdict for t in self.tests}
        if "FAIL" in verdicts:
            return "FAIL"
        if "INCONCLUSIVE" in verdicts:
            return "INCONCLUSIVE"
        return "PASS"


def _window(
    n: int, t0: float, rh0: float, i0: float, v0: float, v_drift: float
) -> List[TelemetryPoint]:
    """Deterministic synthetic telemetry window (no RNG) for overlay graphs."""
    pts: List[TelemetryPoint] = []
    span = max(n - 1, 1)
    for k in range(n):
        f = k / span
        pts.append(
            TelemetryPoint(
                t_min=round(f * 60.0, 2),
                chamber_t_c=round(t0 + 22.0 * math.sin(f * 2 * math.pi), 2),
                chamber_rh_pct=round(rh0 + 5.0 * math.cos(f * 2 * math.pi), 2),
                module_i_a=round(i0 * (1 + 0.02 * math.sin(f * 4 * math.pi)), 3),
                module_v_v=round(v0 * (1 - v_drift * f), 3),
            )
        )
    return pts


def _gct_readings() -> List[ipf.Reading]:
    return [
        ipf.Reading(timestamp_ms=i * 500, voltage=2.0, current=25.0, power=50.0)
        for i in range(6)
    ]


def _demo_run() -> ReportRun:
    """Single golden DEMO run exercising PASS / FAIL / INCONCLUSIVE."""
    tc = ipf.pmax_delta_verdict(305.0, 298.0, clause="IEC 61215-2 MQT 11")
    hf = ipf.pmax_delta_verdict(305.0, 286.0, clause="IEC 61215-2 MQT 12")
    letid = ipf.letid_verdict(312.0, 309.0)
    gct = ipf.ground_continuity_verdict(_gct_readings())
    bdt = ipf.bypass_diode_verdict([])  # no temperature samples → INCONCLUSIVE

    blocks = [
        TestBlock(
            key="tc", name="Thermal Cycling", result=tc, unit="%",
            clause_text=(
                "IEC 61215-2 MQT 11 — 200 thermal cycles between -40 °C and "
                "+85 °C; ΔPmax must stay within -5 % of the pre-test value."
            ),
            raw_csv="data/runs/DEMO-RUN-001/tc.csv",
            evidence=["evidence/tc_chamber_setpoint.png", "evidence/tc_iv_curve.png"],
            window=_window(48, 22.0, 35.0, 9.21, 41.2, 0.012),
        ),
        TestBlock(
            key="hf", name="Humidity Freeze", result=hf, unit="%",
            clause_text=(
                "IEC 61215-2 MQT 12 — 10 humidity-freeze cycles (+85 °C/85 %RH "
                "to -40 °C); ΔPmax must stay within -5 % (Gate-2 criterion)."
            ),
            raw_csv="data/runs/DEMO-RUN-001/hf.csv",
            evidence=["evidence/hf_delam_back.png"],
            window=_window(48, 24.0, 85.0, 9.18, 41.0, 0.062),
        ),
        TestBlock(
            key="letid", name="LeTID", result=letid, unit="%",
            clause_text=(
                "IEC TS 63342 — Isc-Imp forward current at +75 °C for 162 h; "
                "Pmax loss must stay within -2 %."
            ),
            raw_csv="data/runs/DEMO-RUN-001/letid.csv",
            evidence=["evidence/letid_voc_trend.png"],
            window=_window(48, 75.0, 20.0, 4.65, 39.8, 0.010),
        ),
        TestBlock(
            key="gct", name="Ground Continuity", result=gct, unit="Ω",
            clause_text=(
                "IEC 61730-2 MST 13 — drive 25 A between accessible conductive "
                "parts; junction resistance must remain ≤ 0.1 Ω."
            ),
            raw_csv="data/runs/DEMO-RUN-001/gct.csv",
            evidence=["evidence/gct_probe_points.png"],
            window=_window(24, 23.0, 30.0, 25.0, 2.0, 0.0),
        ),
        TestBlock(
            key="bdt", name="Bypass Diode", result=bdt, unit="°C",
            clause_text=(
                "IEC 62979 — force 1.35×Isc through the bypass-diode network "
                "for 1 h; junction temperature must remain ≤ 128 °C."
            ),
            raw_csv="data/runs/DEMO-RUN-001/bdt.csv",
            evidence=[],
            window=_window(36, 75.0, 18.0, 12.4, 0.62, 0.0),
        ),
    ]
    return ReportRun(
        run_id="DEMO-RUN-001",
        module_id="PV-MOD-001",
        test_id="CAMPAIGN-2026-0042",
        standard="IEC 61215 / IEC 61730 / IEC TS 63342",
        operator="A. Nahata",
        reviewer="",
        timestamp_ist="2026-05-28 14:32:10 IST",
        tests=blocks,
    )


_RUNS = {r.run_id: r for r in (_demo_run(),)}


def list_runs() -> List[ReportRun]:
    return list(_RUNS.values())


def get_run(run_id: str) -> Optional[ReportRun]:
    return _RUNS.get(run_id)
