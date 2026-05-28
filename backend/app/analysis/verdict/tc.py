# IEC 61215-2 MQT 11 — Thermal Cycling (DEMO-only). Bespoke evaluator: adds an
# insulation-resistance gate on top of the shared dPmax check.
from __future__ import annotations

from typing import Mapping

from ..iec_pass_fail import Verdict as _Legacy, pmax_delta_verdict
from .base import Verdict, VerdictStatus
from .registry import register

CLAUSE = "IEC 61215-2 MQT 11"
CLAUSE_TEXT = "Thermal cycling 200x (-40..+85 C): dPmax >= -5% AND insulation resistance >= 40 MOhm.m^2"
PMAX_THRESHOLD = -5.0
IR_MIN = 40.0  # MOhm.m^2

@register("tc")
def evaluate(data: Mapping[str, float]) -> Verdict:
    res = pmax_delta_verdict(float(data.get("pre_pmax_w", 0.0)),
                             float(data.get("post_pmax_w", 0.0)),
                             threshold_pct=PMAX_THRESHOLD, clause=CLAUSE)
    ir = data.get("insulation_resistance_mohm_m2")
    margin = None if res.metric is None else round(res.metric - PMAX_THRESHOLD, 4)
    if res.verdict is _Legacy.INSUFFICIENT_DATA or ir is None:
        return Verdict(VerdictStatus.INCONCLUSIVE, CLAUSE, CLAUSE_TEXT,
                       res.metric, PMAX_THRESHOLD, None, ["insufficient data"])
    status = (VerdictStatus.PASS if (res.verdict is _Legacy.PASS and float(ir) >= IR_MIN)
              else VerdictStatus.FAIL)
    return Verdict(status, CLAUSE, CLAUSE_TEXT, res.metric, PMAX_THRESHOLD, margin,
                   [f"IR={float(ir):.1f} MOhm.m^2 (min {IR_MIN})"])
