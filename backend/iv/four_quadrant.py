"""4-Quadrant IV sweep via Keysight B2901A SMU.

The B2901A sources voltage and measures current. We program a linear V
sweep from ``vmin`` to ``vmax`` (typically negative→positive so all four
quadrants of the IV plane are exercised), with configurable dwell, NPLC,
compliance current and 2/4-wire sensing.

Demo mode synthesises a single-diode model curve so the route, UI and
analysis can be exercised without instruments:

    I(V) = Isc - I0 (exp((V + I·Rs)/(nVt)) - 1) - (V + I·Rs)/Rsh

The ITECH PV6000 PSU output is **not** touched here — the route handler
issues ``OUTP OFF`` before each sweep as belt-and-braces.

SCPI commands sent on the B2901A (live mode):
    *RST                          - return to defaults
    :SOUR:FUNC VOLT               - source voltage
    :SENS:FUNC 'CURR'             - measure current
    :SENS:CURR:PROT <I>           - compliance current
    :SENS:CURR:NPLC <nplc>        - integration in power-line cycles
    :SENS:REM ON|OFF              - 4-wire (remote) sensing
    :SOUR:VOLT:MODE SWE           - sweep mode
    :SOUR:VOLT:STAR/STOP/POIN <>  - sweep span and resolution
    :TRIG:SOUR TIM ; :TRIG:TIM <s>; :TRIG:COUN <n>  - dwell + sample count
    :OUTP ON                      - enable SMU output (turned OFF in finally)
    :FETC:ARR:VOLT? / :CURR?      - retrieve sweep arrays
"""
from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass
from typing import Any, List, Optional, Tuple


# Single-diode defaults — ~330 W silicon module under STC.
_ISC = 9.5      # A short-circuit current
_VOC = 41.0     # V open-circuit voltage
_N = 1.3        # ideality factor
_RS = 0.45      # Ω series resistance
_RSH = 350.0    # Ω shunt resistance
_KT_Q = 0.02585  # kT/q at 25 °C (V)

DEFAULT_AREA_M2 = 1.6
DEFAULT_IRRADIANCE_W_M2 = 1000.0


@dataclass
class IvSweepConfig:
    """User-supplied sweep parameters from POST /api/iv/4q/start."""

    vmin: float
    vmax: float
    steps: int = 101
    dwell_ms: float = 20.0
    compliance_i: float = 10.0
    nplc: float = 1.0
    four_wire: bool = True

    def validate(self) -> None:
        if self.vmax <= self.vmin:
            raise ValueError("vmax must be > vmin")
        if self.steps < 2:
            raise ValueError("steps must be >= 2")
        if self.steps > 2001:
            raise ValueError("steps must be <= 2001 (B2901A buffer)")
        if self.dwell_ms < 0:
            raise ValueError("dwell_ms must be >= 0")
        if self.compliance_i <= 0:
            raise ValueError("compliance_i must be > 0")
        if self.nplc <= 0:
            raise ValueError("nplc must be > 0")


@dataclass
class IvCurve:
    """Captured V/I arrays plus derived module figures-of-merit."""

    run_id: str
    v: List[float]
    i: List[float]
    pmax: float
    voc: float
    isc: float
    vmpp: float
    impp: float
    ff: float
    eta: float
    demo: bool
    source: str
    timestamp: int
    config: dict


def _single_diode_current(
    v: float,
    *,
    isc: float = _ISC,
    voc: float = _VOC,
    n: float = _N,
    rs: float = _RS,
    rsh: float = _RSH,
) -> float:
    """Fixed-point solver for the single-diode equation at one voltage.

    Uses the substitution ``I0 ≈ Isc·exp(-Voc/Vt)`` so the exponential is
    evaluated as ``exp((V + I·Rs - Voc)/Vt)`` — safe across the practical
    operating window (and saturates cleanly for V ≫ Voc).
    """
    vt = _KT_Q * n
    i = isc
    for _ in range(40):
        arg = (v + i * rs - voc) / vt
        if arg > 80:  # well past Voc — current saturates near 0
            diode_term = isc * 1e34
        else:
            diode_term = isc * math.exp(arg)
        new_i = isc - diode_term - (v + i * rs) / rsh
        # Clamp to avoid runaway in deep forward bias
        if new_i < -100.0:
            new_i = -100.0
        if abs(new_i - i) < 1e-6:
            return new_i
        i = 0.5 * (i + new_i)  # damped update for stiff regions
    return i


def single_diode_curve(
    vmin: float, vmax: float, steps: int, *, noise: float = 0.005
) -> Tuple[List[float], List[float]]:
    """Synthetic V/I arrays for demo-mode 4-quadrant sweeps."""
    if steps < 2:
        steps = 2
    dv = (vmax - vmin) / (steps - 1)
    vs = [vmin + dv * k for k in range(steps)]
    is_ = [_single_diode_current(v) + random.gauss(0.0, noise) for v in vs]
    return vs, is_


def _interp_at_zero(x: List[float], y: List[float]) -> float:
    """Linear interpolation of ``y`` at ``x = 0``. Returns 0.0 if the
    array never crosses zero — callers handle the degenerate case."""
    for k in range(len(x) - 1):
        a, b = x[k], x[k + 1]
        if (a <= 0 <= b) or (b <= 0 <= a):
            if b == a:
                return y[k]
            t = (0.0 - a) / (b - a)
            return y[k] + t * (y[k + 1] - y[k])
    return 0.0


def compute_metrics(
    v: List[float],
    i: List[float],
    *,
    area_m2: float = DEFAULT_AREA_M2,
    irradiance: float = DEFAULT_IRRADIANCE_W_M2,
) -> dict:
    """Pmax / Voc / Isc / Vmpp / Impp / FF / η from a sorted IV sweep.

    Pmax is searched only in Q1 (V≥0 and I≥0) per IEC convention. Voc is
    interpolated where I crosses zero; Isc where V crosses zero. FF and
    η fall back to 0.0 when undefined.
    """
    if not v or len(v) != len(i):
        return {"pmax": 0.0, "voc": 0.0, "isc": 0.0,
                "vmpp": 0.0, "impp": 0.0, "ff": 0.0, "eta": 0.0}
    pmax = 0.0
    vmpp = 0.0
    impp = 0.0
    for vv, ii in zip(v, i):
        if vv < 0 or ii < 0:
            continue
        p = vv * ii
        if p > pmax:
            pmax, vmpp, impp = p, vv, ii
    isc = _interp_at_zero(v, i)  # I at V=0
    voc = _interp_at_zero(i, v)  # V at I=0
    ff = (pmax / (voc * isc)) if (voc > 0 and isc > 0) else 0.0
    eta = (pmax / (irradiance * area_m2)) if (irradiance > 0 and area_m2 > 0) else 0.0
    return {
        "pmax": pmax, "voc": voc, "isc": isc,
        "vmpp": vmpp, "impp": impp, "ff": ff, "eta": eta,
    }


class B2901aSmu:
    """Async wrapper around the Keysight B2901A SMU.

    The optional ``transport`` is a :class:`backend.app.transports.Transport`
    (typically ``ScpiUsbtmcTransport`` over VISA). When ``demo`` is True or
    no transport is supplied, :func:`single_diode_curve` is returned instead.

    By construction this class never touches the ITECH PV6000; the route
    handler issues ``OUTP OFF`` to the PSU before kicking off a sweep.
    """

    def __init__(self, transport: Optional[Any] = None, *, demo: bool = True) -> None:
        self._transport = transport
        self._demo = demo or transport is None

    @property
    def demo(self) -> bool:
        return self._demo

    async def configure(self, cfg: IvSweepConfig) -> None:
        if self._demo or self._transport is None:
            return
        t = self._transport
        await t.send("*RST")
        await t.send(":SOUR:FUNC VOLT")
        await t.send(":SENS:FUNC 'CURR'")
        await t.send(f":SENS:CURR:PROT {cfg.compliance_i}")
        await t.send(f":SENS:CURR:NPLC {cfg.nplc}")
        await t.send(f":SENS:REM {'ON' if cfg.four_wire else 'OFF'}")
        await t.send(":SOUR:VOLT:MODE SWE")
        await t.send(f":SOUR:VOLT:STAR {cfg.vmin}")
        await t.send(f":SOUR:VOLT:STOP {cfg.vmax}")
        await t.send(f":SOUR:VOLT:POIN {cfg.steps}")
        await t.send(":TRIG:SOUR TIM")
        await t.send(f":TRIG:TIM {cfg.dwell_ms / 1000.0:.6f}")
        await t.send(f":TRIG:COUN {cfg.steps}")

    async def sweep(self, cfg: IvSweepConfig) -> Tuple[List[float], List[float]]:
        cfg.validate()
        if self._demo or self._transport is None:
            return single_diode_curve(cfg.vmin, cfg.vmax, cfg.steps)
        await self.configure(cfg)
        t = self._transport
        await t.send(":OUTP ON")
        try:
            raw_v = await t.query(":FETC:ARR:VOLT?")
            raw_i = await t.query(":FETC:ARR:CURR?")
        finally:
            await t.send(":OUTP OFF")
        vs = [float(x) for x in raw_v.split(",") if x.strip()]
        is_ = [float(x) for x in raw_i.split(",") if x.strip()]
        return vs, is_

    async def acquire(self, cfg: IvSweepConfig, run_id: str) -> IvCurve:
        v, i = await self.sweep(cfg)
        m = compute_metrics(v, i)
        return IvCurve(
            run_id=run_id,
            v=v,
            i=i,
            pmax=m["pmax"],
            voc=m["voc"],
            isc=m["isc"],
            vmpp=m["vmpp"],
            impp=m["impp"],
            ff=m["ff"],
            eta=m["eta"],
            demo=self._demo,
            source="sim" if self._demo else "b2901a",
            timestamp=int(time.time() * 1000),
            config={
                "vmin": cfg.vmin, "vmax": cfg.vmax, "steps": cfg.steps,
                "dwell_ms": cfg.dwell_ms, "compliance_i": cfg.compliance_i,
                "nplc": cfg.nplc, "four_wire": cfg.four_wire,
            },
        )
