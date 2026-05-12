"""IEC 61215-2 MQT 18 — Bypass Diode Thermal Test + Functionality (clause 4.18).

This module implements the two-phase method called out in the 2021 revision
of IEC 61215-2:

    Phase A — Diode Vf vs T calibration (clause 4.18.1).
        * Place selected bypass diodes (typically 3) in a thermal chamber.
        * For each setpoint in CAL_TEMPERATURES_C, dwell DWELL_S to stabilise,
          then apply short calibration pulses of forward current I_test and
          measure the forward voltage Vf with a pulse short enough that
          self-heating is negligible (<= PULSE_MS).
        * Linear-fit Vf = m*T + c per diode; persist {diode_id, m, c, R^2}.

    Phase B — 1 h current bias junction temperature (clause 4.18.1).
        * Mount module per manufacturer; ambient = AMBIENT_C +/- 1 C.
        * Apply continuous forward current = I_test for BIAS_S.
        * At t = BIAS_S switch to a brief Vf-pulse and record Vf_hot.
        * Compute Tj = (Vf_hot - c) / m using the per-diode calibration.
        * Pass if Tj <= Tj_max - margin.

    Phase C — Functionality (clause 4.18.2).
        * After cooldown, apply I_test in forward direction at 25 C, verify
          the diode conducts within tolerance of the calibration prediction.

Demo simulator
--------------
When ``demo`` is true, this module generates physically plausible Vf(T) data
with realistic noise; the diode's effective thermal resistance and an
``aging`` factor in [0, 1] (0 = healthy, 1 = badly degraded) inflate the
Tj rise in Phase B so the failure cases are reachable in a Playwright run.
The accelerated timing (``demo_speedup``) compresses the 15 min dwell and
1 h bias into a few seconds for end-to-end tests.
"""
from __future__ import annotations

import asyncio
import json
import math
import random
import time
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

from ..analysis.bypass_diode import (
    LinearFit,
    evaluate,
    functionality_ok,
    junction_temperature,
    linear_fit,
)


# --- IEC 4.18 procedure constants ---------------------------------------------

CAL_TEMPERATURES_C: tuple[float, ...] = (30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0)
DWELL_S: int = 15 * 60            # chamber stabilisation, clause 4.18.1
PULSE_MS: int = 1                 # short self-heating-negligible pulse
AMBIENT_C: float = 75.0           # Phase B ambient setpoint, +/- 1 C
BIAS_S: int = 3600                # 1 h current bias
DEFAULT_MARGIN_C: float = 10.0
DEFAULT_TJ_TOLERANCE_V: float = 0.15

CATALOG_PATH = Path(__file__).resolve().parents[1] / "data" / "diode_catalog.json"
CALIBRATION_DIR = Path(__file__).resolve().parents[3] / "data" / "calibration" / "bypass_diode"


# --- Catalog ------------------------------------------------------------------

def load_catalog(path: Path = CATALOG_PATH) -> dict:
    """Load and return the full diode catalog JSON."""
    return json.loads(path.read_text(encoding="utf-8"))


def lookup_diode(part_number: str, catalog: Optional[dict] = None) -> dict:
    """Return the diode entry for ``part_number`` or raise ``KeyError``."""
    cat = catalog if catalog is not None else load_catalog()
    for entry in cat.get("diodes", []):
        if entry["part_number"].upper() == part_number.upper():
            return entry
    raise KeyError(f"diode part_number not in catalog: {part_number!r}")


# --- Run state ----------------------------------------------------------------

@dataclass
class DiodeCalibration:
    diode_id: str
    part_number: str
    samples: list = field(default_factory=list)   # list[(T_c, Vf_v)]
    fit: Optional[LinearFit] = None

    def add_sample(self, t_c: float, vf_v: float) -> None:
        self.samples.append((t_c, vf_v))

    def fit_now(self) -> LinearFit:
        ts = [s[0] for s in self.samples]
        vs = [s[1] for s in self.samples]
        self.fit = linear_fit(ts, vs)
        return self.fit

    def to_dict(self) -> dict:
        return {
            "diode_id": self.diode_id,
            "part_number": self.part_number,
            "samples": [{"T_c": t, "Vf_v": v} for t, v in self.samples],
            "fit": self.fit.to_dict() if self.fit else None,
        }


@dataclass
class PhaseBSample:
    t_s: float                  # seconds since start of Phase B
    current_a: float
    voltage_v: float            # measured across the diode string
    chamber_c: float


@dataclass
class BypassDiodeRun:
    run_id: str
    i_test_a: float
    margin_c: float
    diodes: list                  # list[DiodeCalibration]
    phase_b: list = field(default_factory=list)   # list[PhaseBSample]
    vf_hot: dict = field(default_factory=dict)    # diode_id -> Vf
    tj: dict = field(default_factory=dict)        # diode_id -> Tj
    vf_25c: dict = field(default_factory=dict)    # Phase C readings
    verdict: Optional[dict] = None
    functionality: dict = field(default_factory=dict)  # diode_id -> bool
    phase: str = "idle"           # idle | A | B | cooldown | C | done | aborted
    started_at: float = 0.0
    finished_at: float = 0.0

    def to_dict(self) -> dict:
        return {
            "run_id": self.run_id,
            "i_test_a": self.i_test_a,
            "margin_c": self.margin_c,
            "phase": self.phase,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "diodes": [d.to_dict() for d in self.diodes],
            "phase_b": [asdict(s) for s in self.phase_b],
            "vf_hot": self.vf_hot,
            "tj": self.tj,
            "vf_25c": self.vf_25c,
            "functionality": self.functionality,
            "verdict": self.verdict,
        }


# --- Simulator ----------------------------------------------------------------

@dataclass
class DiodeSim:
    """Physical-ish model of a Si Schottky bypass diode.

    Vf(I, T) = vf0 + tc * (T - 25) + rs * I,  where ``vf0`` and ``tc`` are
    drawn around the catalog values per instance to produce realistic
    sample-to-sample variation. The ``aging`` factor in [0, 1] inflates
    the effective thermal resistance so that the 1 h bias drives Tj
    upward of Tj_max in a worst-case fixture.
    """
    diode_id: str
    part_number: str
    vf0_v: float
    tc_v_per_c: float           # e.g. -0.0020 (i.e. -2.0 mV/C)
    rs_ohm: float               # series resistance ~ a few mΩ
    rth_c_per_w: float          # junction-to-ambient
    tj_max_c: float
    aging: float = 0.0          # 0 healthy, 1 severely aged
    noise_v: float = 0.0008     # 0.8 mV Vf measurement noise (1 sigma)

    def vf(self, current_a: float, t_c: float, *, with_noise: bool = True) -> float:
        v = self.vf0_v + self.tc_v_per_c * (t_c - 25.0) + self.rs_ohm * current_a
        if with_noise:
            v += random.gauss(0.0, self.noise_v)
        # Slightly more series resistance as the diode ages.
        v += self.aging * 0.030 * current_a
        return v

    def tj_at_bias(self, current_a: float, ambient_c: float) -> float:
        """Steady-state junction temperature under continuous current."""
        # P = Vf * I, scale rth up with aging to model degraded thermal path
        rth = self.rth_c_per_w * (1.0 + 1.5 * self.aging)
        p = abs(self.vf(current_a, ambient_c, with_noise=False)) * current_a
        return ambient_c + rth * p


def _build_default_sims(
    part_number: str,
    catalog_entry: dict,
    *,
    n: int = 3,
    aging: float = 0.0,
    seed: Optional[int] = None,
) -> list:
    if seed is not None:
        random.seed(seed)
    base_vf = float(catalog_entry["vf_nominal_v"])
    base_tc = float(catalog_entry["tc_vf_mv_per_c"]) / 1000.0
    tj_max = float(catalog_entry["tj_max_c"])
    sims = []
    for k in range(n):
        sims.append(
            DiodeSim(
                diode_id=f"D{k + 1}",
                part_number=part_number,
                vf0_v=base_vf + random.gauss(0.0, 0.005),
                tc_v_per_c=base_tc + random.gauss(0.0, 0.05e-3),
                rs_ohm=0.008 + random.uniform(-0.001, 0.001),
                rth_c_per_w=2.2 + random.uniform(-0.2, 0.2),
                tj_max_c=tj_max,
                aging=aging,
            )
        )
    return sims


# --- State machine ------------------------------------------------------------

class BypassDiodeTest:
    """Run the MQT 18 two-phase procedure.

    ``scpi`` may be ``None`` when ``demo=True`` so the same code path runs
    in CI without any hardware. ``on_event`` (optional) is invoked with a
    ``dict`` payload at every state transition and every Phase B sample,
    so the FastAPI websocket layer can forward live telemetry to the UI.
    """

    STANDARD = "IEC 61215-2 MQT 18"

    def __init__(
        self,
        scpi=None,
        *,
        demo: bool = True,
        on_event=None,
    ):
        self.scpi = scpi
        self.demo = demo
        self.on_event = on_event
        self.run: Optional[BypassDiodeRun] = None
        self._sims: list = []
        self._abort = asyncio.Event()

    # ----- public control surface --------------------------------------------

    async def run_full(
        self,
        *,
        part_number: str,
        n_diodes: int = 3,
        i_test_a: float = 9.5,
        margin_c: float = DEFAULT_MARGIN_C,
        ambient_c: float = AMBIENT_C,
        cal_temperatures_c: tuple = CAL_TEMPERATURES_C,
        dwell_s: int = DWELL_S,
        bias_s: int = BIAS_S,
        aging: float = 0.0,
        demo_speedup: float = 600.0,
        seed: Optional[int] = None,
        persist: bool = True,
    ) -> dict:
        """Execute Phase A -> Phase B -> Phase C and return the result dict.

        ``demo_speedup`` divides the real-time waits so that a Playwright run
        in DEMO mode finishes the full procedure in ~5 s rather than ~1 h.
        """
        run_id = uuid.uuid4().hex[:12]
        catalog = lookup_diode(part_number)
        diodes = [
            DiodeCalibration(diode_id=f"D{i + 1}", part_number=part_number)
            for i in range(n_diodes)
        ]
        self.run = BypassDiodeRun(
            run_id=run_id,
            i_test_a=i_test_a,
            margin_c=margin_c,
            diodes=diodes,
            started_at=time.time(),
        )
        self._sims = (
            _build_default_sims(part_number, catalog, n=n_diodes, aging=aging, seed=seed)
            if self.demo
            else []
        )
        self._abort.clear()

        try:
            await self._phase_a(cal_temperatures_c, dwell_s, demo_speedup)
            await self._phase_b(ambient_c, bias_s, demo_speedup)
            await self._cooldown(ambient_c, demo_speedup)
            await self._phase_c()
            self._finalise(catalog)
            if persist:
                self._persist()
            self.run.phase = "done"
            self.run.finished_at = time.time()
            self._emit({"event": "done", "verdict": self.run.verdict})
        except asyncio.CancelledError:
            self.run.phase = "aborted"
            self.run.finished_at = time.time()
            self._emit({"event": "aborted"})
            raise

        return self.run.to_dict()

    def abort(self) -> None:
        self._abort.set()

    # ----- phases -------------------------------------------------------------

    async def _phase_a(self, temps, dwell_s: int, demo_speedup: float) -> None:
        assert self.run is not None
        self.run.phase = "A"
        self._emit({"event": "phase", "phase": "A", "temperatures": list(temps)})
        wait_s = max(0.05, dwell_s / demo_speedup) if self.demo else dwell_s

        for t_c in temps:
            await self._set_chamber(t_c)
            await self._sleep_or_abort(wait_s)
            for idx, diode in enumerate(self.run.diodes):
                vf = await self._pulse_measure_vf(idx, t_c)
                diode.add_sample(t_c, vf)
                self._emit({
                    "event": "cal_sample",
                    "phase": "A",
                    "diode_id": diode.diode_id,
                    "T_c": t_c,
                    "Vf_v": vf,
                })

        for diode in self.run.diodes:
            diode.fit_now()
            self._emit({
                "event": "cal_fit",
                "diode_id": diode.diode_id,
                "fit": diode.fit.to_dict(),
            })

    async def _phase_b(self, ambient_c: float, bias_s: int, demo_speedup: float) -> None:
        assert self.run is not None
        self.run.phase = "B"
        self._emit({"event": "phase", "phase": "B", "ambient_c": ambient_c, "bias_s": bias_s})
        await self._set_chamber(ambient_c)
        await self._source_dc(self.run.i_test_a)

        total = max(0.05, bias_s / demo_speedup) if self.demo else bias_s
        # 60 samples for a smooth time-series regardless of compression.
        n_samples = 60
        dt = total / n_samples
        start = time.time()
        for k in range(n_samples):
            await self._sleep_or_abort(dt)
            elapsed = (time.time() - start) if not self.demo else (k + 1) * (bias_s / n_samples)
            v_string = await self._measure_voltage()
            sample = PhaseBSample(
                t_s=elapsed,
                current_a=self.run.i_test_a,
                voltage_v=v_string,
                chamber_c=ambient_c,
            )
            self.run.phase_b.append(sample)
            self._emit({"event": "bias_sample", **asdict(sample)})

        # End-of-1h Vf pulse per diode.
        await self._source_off()
        await asyncio.sleep(max(0.01, 0.5 / demo_speedup) if self.demo else 0.5)
        for idx, diode in enumerate(self.run.diodes):
            vf_hot = await self._pulse_measure_vf(idx, ambient_c, hot=True)
            self.run.vf_hot[diode.diode_id] = vf_hot
            tj = junction_temperature(vf_hot, diode.fit)
            self.run.tj[diode.diode_id] = tj
            self._emit({
                "event": "tj",
                "diode_id": diode.diode_id,
                "Vf_hot_v": vf_hot,
                "Tj_c": tj,
            })

    async def _cooldown(self, ambient_c: float, demo_speedup: float) -> None:
        assert self.run is not None
        self.run.phase = "cooldown"
        self._emit({"event": "phase", "phase": "cooldown"})
        await self._set_chamber(25.0)
        await self._sleep_or_abort(max(0.05, 60.0 / demo_speedup) if self.demo else 600.0)

    async def _phase_c(self) -> None:
        assert self.run is not None
        self.run.phase = "C"
        self._emit({"event": "phase", "phase": "C"})
        for idx, diode in enumerate(self.run.diodes):
            vf = await self._pulse_measure_vf(idx, 25.0)
            self.run.vf_25c[diode.diode_id] = vf
            ok = functionality_ok(vf, fit=diode.fit, tolerance_v=DEFAULT_TJ_TOLERANCE_V)
            self.run.functionality[diode.diode_id] = ok
            self._emit({
                "event": "functionality",
                "diode_id": diode.diode_id,
                "Vf_25c_v": vf,
                "ok": ok,
            })

    def _finalise(self, catalog_entry: dict) -> None:
        assert self.run is not None
        rows = []
        for d in self.run.diodes:
            rows.append({
                "diode_id": d.diode_id,
                "part_number": d.part_number,
                "tj_c": self.run.tj[d.diode_id],
                "tj_max_c": float(catalog_entry["tj_max_c"]),
                "r_squared": d.fit.r_squared,
            })
        verdict = evaluate(rows, margin_c=self.run.margin_c)
        # Roll functionality into the verdict.
        func_pass = all(self.run.functionality.values())
        passed = verdict.passed and func_pass
        self.run.verdict = {
            **verdict.to_dict(),
            "passed": passed,
            "functionality_pass": func_pass,
            "iec_clause": "4.18",
            "standard": self.STANDARD,
        }

    # ----- hardware / simulator shims ----------------------------------------

    async def _set_chamber(self, t_c: float) -> None:
        if self.scpi is not None and not self.demo:
            await self.scpi.send(f"SOUR:TEMP {t_c:.2f}")
        self._emit({"event": "chamber_setpoint", "T_c": t_c})

    async def _source_dc(self, current_a: float) -> None:
        if self.scpi is not None and not self.demo:
            await self.scpi.send("SOUR:FUNC CURR")
            await self.scpi.send(f"SOUR:CURR {current_a:.4f}")
            await self.scpi.send("OUTP ON")

    async def _source_off(self) -> None:
        if self.scpi is not None and not self.demo:
            await self.scpi.send("OUTP OFF")

    async def _measure_voltage(self) -> float:
        if self.scpi is not None and not self.demo:
            return float(await self.scpi.query("MEAS:VOLT?"))
        # Demo: total string voltage = sum of per-diode Vf at bias.
        # Use the still-elevated Tj as a proxy for self-heating during bias.
        if not self._sims:
            return 0.0
        return sum(
            s.vf(self._current_a_or_zero(), s.tj_at_bias(self._current_a_or_zero(), AMBIENT_C))
            for s in self._sims
        )

    def _current_a_or_zero(self) -> float:
        return self.run.i_test_a if self.run else 0.0

    async def _pulse_measure_vf(self, idx: int, t_c: float, *, hot: bool = False) -> float:
        """Apply a short PULSE_MS pulse of I_test and capture Vf.

        In hardware mode this issues a pulsed source command and reads the
        gated voltage. In demo mode we model self-heating-negligible if
        the pulse is short, but inflate Vf using the diode's biased Tj
        when ``hot`` is true (Phase B Tj capture).
        """
        if self.scpi is not None and not self.demo:
            await self.scpi.send(f"SOUR:CURR:PULS {self.run.i_test_a:.4f},{PULSE_MS}")
            return float(await self.scpi.query("MEAS:VOLT:PULS?"))
        # Demo path
        sim = self._sims[idx]
        if hot:
            tj = sim.tj_at_bias(self.run.i_test_a, t_c)
            return sim.vf(self.run.i_test_a, tj)
        return sim.vf(self.run.i_test_a, t_c)

    async def _sleep_or_abort(self, seconds: float) -> None:
        if seconds <= 0:
            return
        try:
            await asyncio.wait_for(self._abort.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            return
        # If we get here, abort was set.
        raise asyncio.CancelledError()

    # ----- helpers ------------------------------------------------------------

    def _persist(self) -> None:
        assert self.run is not None
        CALIBRATION_DIR.mkdir(parents=True, exist_ok=True)
        path = CALIBRATION_DIR / f"{self.run.run_id}.json"
        payload = {
            "run_id": self.run.run_id,
            "standard": self.STANDARD,
            "iec_clause": "4.18",
            "i_test_a": self.run.i_test_a,
            "margin_c": self.run.margin_c,
            "diodes": [
                {
                    "diode_id": d.diode_id,
                    "part_number": d.part_number,
                    "m_v_per_c": d.fit.slope,
                    "c_v": d.fit.intercept,
                    "r_squared": d.fit.r_squared,
                    "samples": [{"T_c": t, "Vf_v": v} for t, v in d.samples],
                }
                for d in self.run.diodes
            ],
            "tj": self.run.tj,
            "vf_hot": self.run.vf_hot,
            "vf_25c": self.run.vf_25c,
            "functionality": self.run.functionality,
            "verdict": self.run.verdict,
        }
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        self._emit({"event": "persisted", "path": str(path)})

    def _emit(self, payload: dict) -> None:
        if self.on_event is None:
            return
        try:
            self.on_event(payload)
        except Exception:
            # Telemetry never breaks the test loop.
            pass
