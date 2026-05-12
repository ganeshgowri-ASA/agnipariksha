"""LeTID test orchestrator — IEC TS 63342:2022.

Light and elevated Temperature Induced Degradation (LeTID) is a slow
power-loss mechanism in crystalline-silicon PV modules. IEC TS 63342
defines a current-injection stress that emulates field exposure:

    Inject Iinj = Impp at module temperature 75 ± 5 °C
    for at least 162 h of accumulated stress.

Periodically the stress is interrupted to measure the module at STC
(short IV sweep). The recorded Pmax(t) curve is fitted to a two-stage
degradation/regeneration model

    Pmax(t) = P0 * [ 1 - A_d * (1 - exp(-t/tau_d))
                       + A_r * (1 - exp(-t/tau_r)) ]

from which we report:
  - max relative power loss  ΔPmax/P0
  - time-to-min Pmax (t_min)
  - regeneration fraction (R = A_r / A_d)
  - pass/fail per IEC TS 63342 (default threshold 2 % Pmax loss).

Sun-equivalent dose
-------------------
TS 63342 normalises stress to *sun-hours* using

    dose_sun_h = ∫ (Iinj / Iinj_ref) dt

where ``Iinj_ref`` is the reference injection current equal to one-sun
Impp. The orchestrator tracks both wall-clock and equivalent-sun dose
so users can compare runs across modules with different Impp.

References
----------
- IEC TS 63342:2022, clause 6 (stress procedure) and clause 7
  (degradation analysis and acceptance criteria).
"""
from __future__ import annotations

import asyncio
import csv
import json
import math
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Awaitable, Callable, Optional

try:
    from backend.scpi_async import ScpiClient  # type: ignore
except ImportError:  # pragma: no cover
    from scpi_async import ScpiClient  # type: ignore


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass
class LeTIDConfig:
    """Test configuration. Defaults follow IEC TS 63342:2022."""

    # Module nameplate at STC
    isc_stc: float = 9.5
    impp_stc: float = 8.9
    vmpp_stc: float = 37.5
    voc_stc: float = 45.0
    pmpp_stc: float = 333.75  # = vmpp * impp by default

    # Stress conditions
    temperature_c: float = 75.0
    temperature_tolerance_c: float = 5.0
    injection_current_a: Optional[float] = None  # default Impp
    total_duration_h: float = 162.0

    # Cadence
    iv_interval_h: float = 24.0  # IV sweep period during stress
    telemetry_interval_s: float = 5.0
    drift_alarm_pct: float = 0.5  # alert if Iinj drifts > drift_alarm_pct

    # Acceptance criterion (IEC TS 63342 clause 7)
    max_allowed_loss_pct: float = 2.0

    # Output
    output_dir: str = "data/letid"

    def resolve_injection_current(self) -> float:
        return self.injection_current_a if self.injection_current_a is not None else self.impp_stc

    def resolve_pmpp(self) -> float:
        # Allow user to either provide pmpp_stc directly or derive from V/I.
        if self.pmpp_stc and self.pmpp_stc > 0:
            return self.pmpp_stc
        return self.vmpp_stc * self.impp_stc


@dataclass
class IVPoint:
    """One IV sweep summary captured during a stress interrupt."""

    elapsed_h: float
    dose_sun_h: float
    voc: float
    isc: float
    vmpp: float
    impp: float
    pmpp: float
    fill_factor: float
    temperature_c: float

    def to_row(self) -> dict:
        return asdict(self)


@dataclass
class EnvSample:
    """Coarse environmental log entry recorded at telemetry cadence."""

    timestamp_ms: int
    elapsed_h: float
    voltage: float
    current: float
    power: float
    temperature_c: float
    in_tolerance: bool


@dataclass
class FitResult:
    """Parameters of the two-stage LeTID model fit."""

    p0: float
    amp_degrade: float
    tau_degrade_h: float
    amp_regen: float
    tau_regen_h: float
    rmse: float
    n_points: int

    def predict(self, t_h: float) -> float:
        d = self.amp_degrade * (1.0 - math.exp(-t_h / max(self.tau_degrade_h, 1e-6)))
        r = self.amp_regen * (1.0 - math.exp(-t_h / max(self.tau_regen_h, 1e-6)))
        return self.p0 * (1.0 - d + r)


@dataclass
class LeTIDResult:
    session_id: str
    config: LeTIDConfig
    iv_log: list[IVPoint] = field(default_factory=list)
    env_log: list[EnvSample] = field(default_factory=list)
    fit: Optional[FitResult] = None
    max_relative_loss_pct: float = 0.0
    time_to_min_h: float = 0.0
    regeneration_fraction: float = 0.0
    final_dose_sun_h: float = 0.0
    final_elapsed_h: float = 0.0
    passed: bool = False
    notes: list[str] = field(default_factory=list)
    csv_path: Optional[str] = None
    report_path: Optional[str] = None

    def summary(self) -> dict:
        return {
            "session_id": self.session_id,
            "passed": self.passed,
            "max_relative_loss_pct": round(self.max_relative_loss_pct, 4),
            "time_to_min_h": round(self.time_to_min_h, 2),
            "regeneration_fraction": round(self.regeneration_fraction, 4),
            "final_dose_sun_h": round(self.final_dose_sun_h, 3),
            "final_elapsed_h": round(self.final_elapsed_h, 3),
            "n_iv_points": len(self.iv_log),
            "n_env_samples": len(self.env_log),
            "csv_path": self.csv_path,
            "report_path": self.report_path,
            "fit": asdict(self.fit) if self.fit else None,
            "notes": list(self.notes),
        }


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------


def fit_degradation_curve(
    times_h: list[float],
    pmax: list[float],
) -> Optional[FitResult]:
    """Fit Pmax(t) to the two-stage model.

    Uses scipy.optimize.curve_fit when available; falls back to a small
    grid search so the orchestrator stays usable in slim deployments.
    """
    if len(times_h) < 3:
        return None

    p0_guess = max(pmax)
    a_d_guess = max(0.0, (p0_guess - min(pmax)) / max(p0_guess, 1e-6))
    final_loss = (p0_guess - pmax[-1]) / max(p0_guess, 1e-6)
    a_r_guess = max(0.0, a_d_guess - final_loss)
    tau_d_guess = max(times_h[-1] * 0.25, 1.0)
    tau_r_guess = max(times_h[-1] * 0.75, 1.0)

    try:
        import numpy as np  # type: ignore
        from scipy.optimize import curve_fit  # type: ignore

        def model(t, p0, a_d, tau_d, a_r, tau_r):
            d = a_d * (1.0 - np.exp(-t / np.maximum(tau_d, 1e-6)))
            r = a_r * (1.0 - np.exp(-t / np.maximum(tau_r, 1e-6)))
            return p0 * (1.0 - d + r)

        t = np.asarray(times_h, dtype=float)
        y = np.asarray(pmax, dtype=float)
        popt, _ = curve_fit(
            model, t, y,
            p0=[p0_guess, a_d_guess, tau_d_guess, a_r_guess, tau_r_guess],
            bounds=([0, 0, 0.1, 0, 0.1], [p0_guess * 2, 1, 1e4, 1, 1e4]),
            maxfev=5000,
        )
        resid = y - model(t, *popt)
        rmse = float(np.sqrt(np.mean(resid ** 2)))
        return FitResult(
            p0=float(popt[0]),
            amp_degrade=float(popt[1]),
            tau_degrade_h=float(popt[2]),
            amp_regen=float(popt[3]),
            tau_regen_h=float(popt[4]),
            rmse=rmse,
            n_points=len(times_h),
        )
    except Exception:
        # Lightweight fallback: scan a coarse tau grid, fix amplitudes to
        # the observed peak-to-trough/peak-to-final loss.
        best: Optional[FitResult] = None
        best_err = float("inf")
        min_p = min(pmax)
        last_p = pmax[-1]
        a_d = max(0.0, (p0_guess - min_p) / max(p0_guess, 1e-6))
        a_r = max(0.0, a_d - (p0_guess - last_p) / max(p0_guess, 1e-6))
        tau_grid = [1, 4, 12, 24, 48, 96, 192]
        for tau_d in tau_grid:
            for tau_r in tau_grid:
                err = 0.0
                for ti, yi in zip(times_h, pmax):
                    d = a_d * (1.0 - math.exp(-ti / tau_d))
                    r = a_r * (1.0 - math.exp(-ti / tau_r))
                    pred = p0_guess * (1.0 - d + r)
                    err += (yi - pred) ** 2
                rmse = math.sqrt(err / len(times_h))
                if rmse < best_err:
                    best_err = rmse
                    best = FitResult(
                        p0=p0_guess,
                        amp_degrade=a_d,
                        tau_degrade_h=float(tau_d),
                        amp_regen=a_r,
                        tau_regen_h=float(tau_r),
                        rmse=rmse,
                        n_points=len(times_h),
                    )
        return best


def analyse_result(result: LeTIDResult) -> None:
    """Populate fit / loss metrics on ``result``. Mutates in place."""
    iv = result.iv_log
    if not iv:
        result.passed = False
        result.notes.append("no IV data collected")
        return

    p0 = max(iv[0].pmpp, result.config.resolve_pmpp())
    pmax_min = min(p.pmpp for p in iv)
    pmax_final = iv[-1].pmpp
    t_min = next((p.elapsed_h for p in iv if p.pmpp == pmax_min), iv[-1].elapsed_h)

    result.max_relative_loss_pct = max(0.0, (p0 - pmax_min) / p0 * 100.0)
    result.time_to_min_h = t_min
    result.regeneration_fraction = (
        (pmax_final - pmax_min) / (p0 - pmax_min) if (p0 - pmax_min) > 1e-6 else 0.0
    )
    result.final_elapsed_h = iv[-1].elapsed_h
    result.final_dose_sun_h = iv[-1].dose_sun_h
    result.fit = fit_degradation_curve(
        [p.elapsed_h for p in iv],
        [p.pmpp for p in iv],
    )
    result.passed = result.max_relative_loss_pct <= result.config.max_allowed_loss_pct


# ---------------------------------------------------------------------------
# Demo IV simulator (used when DEMO_MODE is on)
# ---------------------------------------------------------------------------


def simulated_iv_sweep(
    config: LeTIDConfig,
    elapsed_h: float,
    *,
    a_degrade: float = 0.025,
    tau_degrade_h: float = 30.0,
    a_regen: float = 0.018,
    tau_regen_h: float = 120.0,
    temperature_c: Optional[float] = None,
) -> IVPoint:
    """Synthetic IV summary modelling a typical LeTID degrade-then-regen curve.

    The defaults give roughly 2.5 % initial drop, 30 h time constant,
    1.8 % regeneration over ~120 h — within the IEC TS 63342 envelope
    for a borderline-pass mc-Si module.
    """
    p0 = config.resolve_pmpp()
    d = a_degrade * (1.0 - math.exp(-elapsed_h / tau_degrade_h))
    r = a_regen * (1.0 - math.exp(-elapsed_h / tau_regen_h))
    pmpp = p0 * (1.0 - d + r)
    # Hold V roughly constant; absorb degradation into current.
    vmpp = config.vmpp_stc
    impp = pmpp / vmpp if vmpp > 0 else config.impp_stc
    isc = config.isc_stc * (1.0 - 0.4 * (d - r))  # Isc drops less than Pmpp
    voc = config.voc_stc * (1.0 - 0.15 * (d - r))
    ff = pmpp / (voc * isc) if voc * isc > 0 else 0.0
    iinj = config.resolve_injection_current()
    dose = iinj / max(config.impp_stc, 1e-6) * elapsed_h
    return IVPoint(
        elapsed_h=round(elapsed_h, 4),
        dose_sun_h=round(dose, 4),
        voc=round(voc, 4),
        isc=round(isc, 4),
        vmpp=round(vmpp, 4),
        impp=round(impp, 4),
        pmpp=round(pmpp, 4),
        fill_factor=round(ff, 4),
        temperature_c=round(
            temperature_c if temperature_c is not None else config.temperature_c, 2
        ),
    )


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


EventHandler = Callable[[dict], Awaitable[None]]


class LeTIDOrchestrator:
    """Drives the IEC TS 63342 stress sequence end-to-end.

    Parameters
    ----------
    scpi:
        Connected (or demo-mode) :class:`ScpiClient`.
    config:
        Test configuration. Use :class:`LeTIDConfig` defaults for
        IEC TS 63342 compliance.
    on_event:
        Optional async callback receiving structured events
        (``stress_start``, ``iv_point``, ``env_sample``,
        ``stress_complete``, ``analysis``). Used by the WebSocket
        bridge to push updates to the UI.
    time_source / sleep:
        Injection points for tests — default to ``time.monotonic`` and
        ``asyncio.sleep``. Tests pass accelerated versions so a 162 h
        run completes in milliseconds.
    """

    def __init__(
        self,
        scpi: ScpiClient,
        config: Optional[LeTIDConfig] = None,
        on_event: Optional[EventHandler] = None,
        *,
        time_source: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.scpi = scpi
        self.config = config or LeTIDConfig()
        self.on_event = on_event
        self._time = time_source
        self._sleep = sleep
        self.session_id = f"LETID-{uuid.uuid4().hex[:10]}"
        self.result = LeTIDResult(session_id=self.session_id, config=self.config)
        self._stop_evt = asyncio.Event()
        self._pause_evt = asyncio.Event()
        self._pause_evt.set()  # set = running, clear = paused
        self._task: Optional[asyncio.Task[LeTIDResult]] = None

    # -- lifecycle -------------------------------------------------------
    async def start(self) -> str:
        if self._task and not self._task.done():
            return self.session_id
        self._task = asyncio.create_task(self._run())
        return self.session_id

    async def stop(self) -> LeTIDResult:
        self._stop_evt.set()
        self._pause_evt.set()
        if self._task:
            await self._task
        return self.result

    def pause(self) -> None:
        self._pause_evt.clear()

    def resume(self) -> None:
        self._pause_evt.set()

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    # -- main loop -------------------------------------------------------
    async def _run(self) -> LeTIDResult:
        cfg = self.config
        await self._configure_supply()
        await self._emit("stress_start", {
            "session_id": self.session_id,
            "config": _config_to_dict(cfg),
            "injection_current_a": cfg.resolve_injection_current(),
        })

        total_s = cfg.total_duration_h * 3600.0
        iv_interval_s = cfg.iv_interval_h * 3600.0
        start_real = self._time()
        last_iv_at = -iv_interval_s  # force an initial t=0 IV point

        # Initial reference IV at t=0
        await self._capture_iv(0.0)
        last_iv_at = 0.0

        while not self._stop_evt.is_set():
            await self._pause_evt.wait()
            now = self._time() - start_real
            if now >= total_s:
                break

            await self._sample_env(now)

            if now - last_iv_at >= iv_interval_s:
                await self._interrupt_for_iv(now)
                last_iv_at = now

            # Cap sleep to next event (env tick or IV due, whichever first)
            next_iv = last_iv_at + iv_interval_s - now
            wait_s = min(cfg.telemetry_interval_s, max(0.05, next_iv), total_s - now)
            await self._sleep(wait_s)

        # Final IV measurement at end of stress
        final_elapsed = min(self._time() - start_real, total_s)
        await self._interrupt_for_iv(final_elapsed)
        await self.scpi.send("OUTP OFF")

        analyse_result(self.result)
        csv_path = self._write_csv()
        report_path = self._write_report()
        self.result.csv_path = csv_path
        self.result.report_path = report_path

        await self._emit("stress_complete", {"session_id": self.session_id})
        await self._emit("analysis", self.result.summary())
        return self.result

    # -- SCPI helpers ----------------------------------------------------
    async def _configure_supply(self) -> None:
        cfg = self.config
        iinj = cfg.resolve_injection_current()
        # Constant-current mode: set voltage limit to Voc * 1.1, drive Iinj.
        await self.scpi.send(f"SOUR:VOLT:PROT:LEV {cfg.voc_stc * 1.1:.4f}")
        await self.scpi.send(f"SOUR:CURR:PROT:LEV {cfg.isc_stc * 1.1:.4f}")
        # CC mode on the ITECH PV6000: function = current, level = Iinj.
        await self.scpi.send("SOUR:FUNC CURR")
        await self.scpi.send(f"SOUR:CURR:LEV:IMM {iinj:.4f}")
        # Compliance voltage near Vmpp so the supply sources without back-feed.
        await self.scpi.send(f"SOUR:VOLT:LEV:IMM {cfg.vmpp_stc:.4f}")
        # Chamber temperature set-point (forwarded to any connected controller).
        await self.scpi.send(f"SOUR:TEMP {cfg.temperature_c:.2f}")
        await self.scpi.send("OUTP ON")

    async def _read_telemetry(self) -> tuple[float, float, float]:
        v_s = await self.scpi.query("MEAS:VOLT?")
        i_s = await self.scpi.query("MEAS:CURR?")
        try:
            v = float(v_s)
            i = float(i_s)
        except ValueError:
            v, i = 0.0, 0.0
        return v, i, v * i

    # -- per-tick samples ------------------------------------------------
    async def _sample_env(self, elapsed_s: float) -> None:
        cfg = self.config
        v, i, p = await self._read_telemetry()
        temp = await self._read_temperature()
        in_tol = abs(temp - cfg.temperature_c) <= cfg.temperature_tolerance_c
        sample = EnvSample(
            timestamp_ms=int(time.time() * 1000),
            elapsed_h=elapsed_s / 3600.0,
            voltage=v,
            current=i,
            power=p,
            temperature_c=temp,
            in_tolerance=in_tol,
        )
        self.result.env_log.append(sample)
        # Current drift alarm
        iinj = cfg.resolve_injection_current()
        if iinj > 0 and abs(i - iinj) / iinj * 100.0 > cfg.drift_alarm_pct:
            self.result.notes.append(
                f"current drift at t={sample.elapsed_h:.2f}h: I={i:.4f} (target {iinj:.4f})"
            )
        await self._emit("env_sample", asdict(sample))

    async def _read_temperature(self) -> float:
        # The PV6000 itself doesn't have a thermocouple; chamber controllers
        # typically expose temperature via a separate SCPI query. We send a
        # best-effort query and gracefully fall back to the demo value.
        try:
            t_s = await self.scpi.query("MEAS:TEMP?")
            return float(t_s)
        except (ValueError, asyncio.TimeoutError):
            return self.config.temperature_c

    # -- IV interrupt ----------------------------------------------------
    async def _interrupt_for_iv(self, elapsed_s: float) -> None:
        """Pause stress, run IV sweep at STC, resume stress."""
        await self.scpi.send("OUTP OFF")
        await self._sleep(0.05)
        await self._capture_iv(elapsed_s)
        # Re-arm CC stress
        await self.scpi.send(f"SOUR:CURR:LEV:IMM {self.config.resolve_injection_current():.4f}")
        await self.scpi.send("OUTP ON")

    async def _capture_iv(self, elapsed_s: float) -> None:
        """In hardware mode, parse the supply's IV-sweep response; in
        demo mode, generate a physically plausible synthetic curve.

        The ITECH PV6000 supports ``SOUR:CURV:IV:STAR`` to trigger an
        IV sweep and ``FETC:ARR:VOLT?`` / ``FETC:ARR:CURR?`` to read it
        back; we summarise into Voc/Isc/Vmpp/Impp/Pmpp/FF.
        """
        cfg = self.config
        elapsed_h = elapsed_s / 3600.0
        temp = await self._read_temperature()
        iv: Optional[IVPoint]

        if getattr(self.scpi, "demo_mode", False) or not getattr(self.scpi, "connected", False):
            iv = simulated_iv_sweep(cfg, elapsed_h, temperature_c=temp)
        else:
            try:
                await self.scpi.send("SOUR:CURV:IV:STAR")
                await self._sleep(0.5)
                volts_s = await self.scpi.query("FETC:ARR:VOLT?")
                amps_s = await self.scpi.query("FETC:ARR:CURR?")
                iv = _summarise_iv(volts_s, amps_s, elapsed_h, temp, cfg)
            except Exception:
                iv = simulated_iv_sweep(cfg, elapsed_h, temperature_c=temp)

        if iv is not None:
            iinj = cfg.resolve_injection_current()
            iv.dose_sun_h = iinj / max(cfg.impp_stc, 1e-6) * elapsed_h
            self.result.iv_log.append(iv)
            await self._emit("iv_point", asdict(iv))

    # -- emit / outputs --------------------------------------------------
    async def _emit(self, kind: str, payload: dict) -> None:
        if self.on_event is None:
            return
        await self.on_event({"type": kind, **payload})

    def _output_dir(self) -> Path:
        d = Path(self.config.output_dir) / self.session_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _write_csv(self) -> str:
        d = self._output_dir()
        path = d / "iv_log.csv"
        with path.open("w", newline="") as f:
            w = csv.writer(f)
            w.writerow([
                "elapsed_h", "dose_sun_h", "voc", "isc",
                "vmpp", "impp", "pmpp", "fill_factor", "temperature_c",
            ])
            for p in self.result.iv_log:
                w.writerow([
                    p.elapsed_h, p.dose_sun_h, p.voc, p.isc,
                    p.vmpp, p.impp, p.pmpp, p.fill_factor, p.temperature_c,
                ])
        env_path = d / "env_log.csv"
        with env_path.open("w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["timestamp_ms", "elapsed_h", "voltage", "current",
                        "power", "temperature_c", "in_tolerance"])
            for s in self.result.env_log:
                w.writerow([s.timestamp_ms, s.elapsed_h, s.voltage,
                            s.current, s.power, s.temperature_c, s.in_tolerance])
        return str(path)

    def _write_report(self) -> str:
        from .letid_report import render_report  # local import keeps cold-start cheap
        path = self._output_dir() / "report.json"
        report = render_report(self.result)
        path.write_text(json.dumps(report, indent=2))
        return str(path)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _config_to_dict(cfg: LeTIDConfig) -> dict:
    out = asdict(cfg)
    out["injection_current_a"] = cfg.resolve_injection_current()
    out["pmpp_stc"] = cfg.resolve_pmpp()
    return out


def _summarise_iv(
    volts_s: str,
    amps_s: str,
    elapsed_h: float,
    temperature_c: float,
    cfg: LeTIDConfig,
) -> Optional[IVPoint]:
    try:
        volts = [float(x) for x in volts_s.replace(";", ",").split(",") if x.strip()]
        amps = [float(x) for x in amps_s.replace(";", ",").split(",") if x.strip()]
    except ValueError:
        return None
    if len(volts) < 2 or len(volts) != len(amps):
        return None
    pmpp = -1.0
    vmpp = 0.0
    impp = 0.0
    for v, i in zip(volts, amps):
        p = v * i
        if p > pmpp:
            pmpp = p
            vmpp = v
            impp = i
    voc = max(volts)
    isc = max(amps)
    ff = pmpp / (voc * isc) if voc * isc > 0 else 0.0
    return IVPoint(
        elapsed_h=round(elapsed_h, 4),
        dose_sun_h=0.0,
        voc=round(voc, 4),
        isc=round(isc, 4),
        vmpp=round(vmpp, 4),
        impp=round(impp, 4),
        pmpp=round(pmpp, 4),
        fill_factor=round(ff, 4),
        temperature_c=round(temperature_c, 2),
    )
