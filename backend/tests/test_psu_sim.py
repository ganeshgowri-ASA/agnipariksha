"""Unit tests for the simulated PSU driver + DEMO_MODE factory.

Pure in-process - no sockets, no hardware.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Make backend importable when running pytest from repo root or backend/.
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.psu import PSUDriver, list_drivers  # noqa: E402
from backend.psu.factory import get_psu_for_mode  # noqa: E402
from backend.psu.itech import ITechPV6000Driver  # noqa: E402
from backend.psu.sim import SimulatedPSUDriver  # noqa: E402


def test_sim_driver_registered() -> None:
    assert "sim" in list_drivers()


def test_sim_connect_returns_expected_idn() -> None:
    sim = SimulatedPSUDriver()
    idn = sim.connect()
    assert idn == "SIM,PSU,DEMO,1.0"
    assert sim.idn() == "SIM,PSU,DEMO,1.0"
    sim.disconnect()


def test_sim_set_then_measure_round_trip() -> None:
    # Noise sigma is 0.01 V / 0.005 A; 5-sigma windows stay deterministic.
    sim = SimulatedPSUDriver()
    sim.connect()
    sim.set_voltage(48.0); sim.set_current(9.5); sim.output_on()
    assert abs(sim.measure_voltage() - 48.0) < 0.05
    assert abs(sim.measure_current() - 9.5) < 0.025
    assert abs(sim.measure_power() - 48.0 * 9.5) < 1.0
    sim.disconnect()


def test_sim_measures_zero_when_output_off() -> None:
    sim = SimulatedPSUDriver()
    sim.connect()
    sim.set_voltage(48.0)
    sim.set_current(9.5)
    # No output_on() yet
    assert sim.measure_voltage() == 0.0
    assert sim.measure_current() == 0.0
    assert sim.measure_power() == 0.0


def test_sim_disconnect_clears_state() -> None:
    sim = SimulatedPSUDriver()
    sim.connect()
    sim.output_on()
    assert sim._output is True  # type: ignore[attr-defined]
    sim.disconnect()
    assert sim._output is False  # type: ignore[attr-defined]
    assert sim._connected is False  # type: ignore[attr-defined]


def test_sim_is_psudriver_subclass() -> None:
    assert issubclass(SimulatedPSUDriver, PSUDriver)
    inst = SimulatedPSUDriver()
    assert isinstance(inst, PSUDriver)


def test_factory_returns_sim_in_demo_mode() -> None:
    psu = get_psu_for_mode(demo_mode=True)
    assert isinstance(psu, SimulatedPSUDriver)
    assert psu.idn() == "SIM,PSU,DEMO,1.0"


def test_factory_returns_itech_in_live_mode() -> None:
    psu = get_psu_for_mode(demo_mode=False)
    assert isinstance(psu, ITechPV6000Driver)


def test_factory_honours_settings_demo_mode_default() -> None:
    # Settings.DEMO_MODE defaults to True, so without an explicit override
    # the factory must return the simulator. This is the safety net that
    # protects CI from accidentally hitting hardware.
    psu = get_psu_for_mode()  # no override
    assert isinstance(psu, SimulatedPSUDriver), (
        "Factory returned a live driver under default DEMO_MODE=true - "
        "this would break the no-live-SCPI-in-CI invariant."
    )


def test_factory_unknown_live_make_raises() -> None:
    with pytest.raises(KeyError):
        get_psu_for_mode(live_make="not_a_real_psu", demo_mode=False)
