"""Synthetic measurement generators for DEMO_MODE.

Each generator yields realistic (voltage, current, power, step, extra) tuples
for one of the six IEC test programs. They are deterministic in shape but
include small Gaussian noise so the live UI looks alive.

These are NOT models of the real DUT — they exist to exercise the WebSocket,
DB, and report pipeline without hardware.
"""
from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass
from typing import Callable, Dict


@dataclass
class Reading:
    v: float
    i: float
    p: float
    step: int
    extra: dict

    def to_payload(self) -> dict:
        return {
            "v": round(self.v, 4),
            "i": round(self.i, 4),
            "p": round(self.p, 4),
            "step": self.step,
            "extra": self.extra,
        }


# Default panel-class parameters used when callers don't override.
DEFAULTS = {
    "isc": 10.0,
    "imp": 9.2,
    "voc": 48.5,
    "vmp": 40.0,
}


def _noise(sigma: float) -> float:
    return random.gauss(0.0, sigma)


def gen_tc(t: float, params: Dict | None = None) -> Reading:
    """Thermal cycling (IEC 61215 MQT11): I=Isc, temperature ramps -40↔+85.

    Period ~ 60s in demo = one synthetic 'cycle'.
    """
    p = {**DEFAULTS, **(params or {})}
    cycle = int(t // 60)
    phase = (t % 60) / 60.0
    temp_c = -40 + 125 * (0.5 - 0.5 * math.cos(2 * math.pi * phase))
    i = p["isc"] + _noise(0.02)
    v = 0.5 + _noise(0.005)
    return Reading(v=v, i=i, p=v * i, step=cycle, extra={"temp_c": round(temp_c, 2), "cycle": cycle})


def gen_hf(t: float, params: Dict | None = None) -> Reading:
    """Humidity freeze (IEC 61215 MQT12): RH 85%, +85→-40, I=Isc."""
    p = {**DEFAULTS, **(params or {})}
    phase = (t % 1440) / 1440.0  # 24-min demo cycle
    temp_c = 85 - 125 * phase if phase < 0.5 else -40 + 250 * (phase - 0.5)
    rh = 85.0 + _noise(0.5)
    i = p["isc"] + _noise(0.02)
    v = 0.5 + _noise(0.005)
    return Reading(v=v, i=i, p=v * i, step=int(t // 60), extra={"temp_c": round(temp_c, 2), "rh": round(rh, 1)})


def gen_letid(t: float, params: Dict | None = None) -> Reading:
    """LeTID (IEC TS 63342): Idark = Isc-Imp at 75°C for 162h."""
    p = {**DEFAULTS, **(params or {})}
    idark = p["isc"] - p["imp"]
    i = idark + _noise(0.01)
    v = 0.5 + _noise(0.003)
    # Slow drift to simulate degradation
    drift = -0.02 * math.tanh(t / 3600.0)
    return Reading(
        v=v,
        i=i + drift,
        p=v * (i + drift),
        step=int(t // 600),
        extra={"temp_c": round(75 + _noise(0.3), 2), "elapsed_h": round(t / 3600.0, 4)},
    )


def gen_bdt(t: float, params: Dict | None = None) -> Reading:
    """Bypass diode (IEC 62979): 1.35×Isc for 1h, diode temp rises."""
    p = {**DEFAULTS, **(params or {})}
    i_test = 1.35 * p["isc"]
    # Asymptotic temp rise to ~150°C
    diode_t = 25 + 125 * (1 - math.exp(-t / 600.0))
    i = i_test + _noise(0.05)
    v = 0.8 + _noise(0.01)
    return Reading(v=v, i=i, p=v * i, step=int(t // 60), extra={"diode_t_c": round(diode_t, 2)})


def gen_rco(t: float, params: Dict | None = None) -> Reading:
    """Reverse current overload (IEC 61730 MST26): 135% fuse rating."""
    p = {**DEFAULTS, **(params or {})}
    fuse = params.get("fuse_rating", 15.0) if params else 15.0
    i_test = 1.35 * fuse
    i = i_test + _noise(0.1)
    v = 2.5 + _noise(0.02)
    return Reading(v=v, i=i, p=v * i, step=int(t // 30), extra={"fuse_rating_a": fuse})


def gen_gct(t: float, params: Dict | None = None) -> Reading:
    """Ground continuity (IEC 61730 MST13): 25A, R < 0.1Ω."""
    i_test = 25.0
    # Synthesise a target resistance ~ 0.05Ω with jitter
    r = 0.05 + _noise(0.005)
    v = r * i_test + _noise(0.02)
    i = i_test + _noise(0.05)
    return Reading(v=v, i=i, p=v * i, step=int(t // 5), extra={"resistance_ohm": round(r, 5)})


GENERATORS: Dict[str, Callable[[float, Dict | None], Reading]] = {
    "tc": gen_tc,
    "hf": gen_hf,
    "letid": gen_letid,
    "bdt": gen_bdt,
    "rco": gen_rco,
    "gct": gen_gct,
}


def get_generator(test_id: str) -> Callable[[float, Dict | None], Reading]:
    """Return the generator for a test id, falling back to TC if unknown."""
    return GENERATORS.get(test_id.lower(), gen_tc)


def evaluate_pass_fail(test_id: str, readings: list[dict]) -> dict:
    """Trivial pass/fail rules for demo data. Real evaluation lives in
    tests_orchestrator (provided by another session)."""
    if not readings:
        return {"verdict": "INCONCLUSIVE", "reason": "no data"}
    tid = test_id.lower()
    last = readings[-1]
    if tid == "gct":
        r = last.get("extra", {}).get("resistance_ohm", 1.0)
        return {"verdict": "PASS" if r < 0.1 else "FAIL", "metric": "R_ohm", "value": r, "limit": 0.1}
    if tid == "bdt":
        t_c = last.get("extra", {}).get("diode_t_c", 0)
        return {"verdict": "PASS" if t_c < 175 else "FAIL", "metric": "diode_T_C", "value": t_c, "limit": 175}
    # Default: held current/voltage stability
    avg_i = sum(r["i"] for r in readings) / len(readings)
    stable = all(abs(r["i"] - avg_i) < 0.5 for r in readings[-min(20, len(readings)):])
    return {"verdict": "PASS" if stable else "FAIL", "metric": "I_stability", "avg_i": round(avg_i, 3)}
