"""Hard-interlock tests for the SCPIDriver Basic Check gate.

CRITICAL: these tests never connect to a real socket. The driver's
``send()`` calls ``_enforce_basic_check`` BEFORE touching ``self._sock``,
so PSU-energizing commands are refused even when no socket exists.
A measurement query (``MEAS:VOLT?``) is NOT energizing and only fails
when the socket is missing — that's the control case proving the gate
discriminates correctly between read and write paths.
"""
from __future__ import annotations

import pytest

try:
    from backend.basic_check import get_store
    from backend.scpi_driver import BasicCheckRequired, SCPIDriver
except ImportError:  # pragma: no cover - script-mode fallback
    from basic_check import get_store  # type: ignore[no-redef]
    from scpi_driver import BasicCheckRequired, SCPIDriver  # type: ignore[no-redef]


@pytest.fixture(autouse=True)
def _clear_store():
    get_store().clear()
    yield
    get_store().clear()


def _driver() -> SCPIDriver:
    """Driver instance with no real socket; gate runs before any I/O."""
    return SCPIDriver()


def test_outp_on_blocked_without_module_bound():
    d = _driver()
    with pytest.raises(BasicCheckRequired) as ei:
        d.output_on()
    assert ei.value.cmd.upper().startswith("OUTP")
    assert ei.value.module_id is None


def test_outp_on_blocked_without_basic_check_pass():
    d = _driver()
    d.set_active_module("MOD-42")
    with pytest.raises(BasicCheckRequired) as ei:
        d.output_on()
    assert ei.value.module_id == "MOD-42"


def test_set_voltage_blocked_without_pass():
    d = _driver()
    d.set_active_module("MOD-42")
    with pytest.raises(BasicCheckRequired):
        d.set_voltage(12.0)


def test_set_current_blocked_without_pass():
    d = _driver()
    d.set_active_module("MOD-42")
    with pytest.raises(BasicCheckRequired):
        d.set_current(5.0)


def test_set_ovp_blocked_without_pass():
    """Protection-level set commands also energize a register; must be gated."""
    d = _driver()
    d.set_active_module("MOD-42")
    with pytest.raises(BasicCheckRequired):
        d.set_ovp(30.0)


def test_energize_allowed_after_basic_check_pass():
    """Once Basic Check passes, the gate permits the energize call;
    the subsequent ConnectionError proves we reached the socket layer."""
    d = _driver()
    d.set_active_module("MOD-42")
    get_store().record_pass("MOD-42")
    # Gate passes; socket is None → ConnectionError, NOT BasicCheckRequired.
    with pytest.raises(ConnectionError):
        d.output_on()
    with pytest.raises(ConnectionError):
        d.set_voltage(12.0)
    with pytest.raises(ConnectionError):
        d.set_current(5.0)


def test_pass_for_other_module_does_not_unlock():
    d = _driver()
    d.set_active_module("MOD-42")
    get_store().record_pass("MOD-OTHER")
    with pytest.raises(BasicCheckRequired):
        d.output_on()


def test_measurement_query_never_gated():
    """MEAS:VOLT? is read-only and must NEVER be refused by the gate.
    No socket → ConnectionError from send(), proving we passed the gate."""
    d = _driver()
    # No active module, no pass — query should still flow past the gate.
    with pytest.raises(ConnectionError):
        d.measure_voltage()


def test_output_off_never_gated():
    """OUTP OFF is a safe-down command and must always succeed past the gate."""
    d = _driver()
    with pytest.raises(ConnectionError):
        d.output_off()


def test_run_thermal_cycling_step_blocked_without_pass():
    """Test sequence orchestrators MUST also be gated transitively via send()."""
    d = _driver()
    d.set_active_module("MOD-42")
    with pytest.raises(BasicCheckRequired):
        d.run_thermal_cycling_step(isc=8.0, cycles=1)
