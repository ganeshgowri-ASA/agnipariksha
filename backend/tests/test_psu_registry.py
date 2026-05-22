"""Unit tests for the PSU driver registry + ABC.

No hardware, no sockets - the registry layer is pure Python.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Make ``backend`` importable when running pytest from repo root or backend/.
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.psu import (  # noqa: E402
    PSUDriver,
    get_driver,
    list_drivers,
    register_driver,
)
from backend.psu.itech import ITechPV6000Driver  # noqa: E402


def test_itech_pv6000_is_registered_by_default() -> None:
    # Importing backend.psu triggers itech.py's @register_driver call.
    assert "itech_pv6000" in list_drivers()
    assert get_driver("itech_pv6000") is ITechPV6000Driver


def test_get_driver_unknown_raises_keyerror_with_known_list() -> None:
    with pytest.raises(KeyError) as exc_info:
        get_driver("nonexistent_vendor_xyz")
    # The error message must include the registered keys so misconfig
    # is debuggable from the log alone.
    assert "itech_pv6000" in str(exc_info.value)


def test_register_driver_rejects_non_psudriver_subclass() -> None:
    class NotAPSU:  # missing PSUDriver base
        pass

    with pytest.raises(TypeError):
        register_driver("garbage", NotAPSU)  # type: ignore[arg-type]


def test_register_driver_rejects_empty_make() -> None:
    with pytest.raises(ValueError):
        register_driver("", ITechPV6000Driver)


def test_psudriver_abc_cannot_be_instantiated_directly() -> None:
    with pytest.raises(TypeError):
        PSUDriver()  # type: ignore[abstract]


def test_register_driver_round_trip_for_custom_subclass() -> None:
    class FakeDriver(PSUDriver):
        make = "fake"
        model = "X1"

        def connect(self) -> str:
            return "FAKE,X1,0,0"

        def disconnect(self) -> None:
            pass

        def idn(self) -> str:
            return "FAKE,X1,0,0"

        def output_on(self) -> None:
            pass

        def output_off(self) -> None:
            pass

        def set_voltage(self, v: float) -> None:
            pass

        def set_current(self, i: float) -> None:
            pass

        def measure_voltage(self) -> float:
            return 0.0

        def measure_current(self) -> float:
            return 0.0

        def measure_power(self) -> float:
            return 0.0

    register_driver("fake_round_trip", FakeDriver)
    try:
        assert get_driver("fake_round_trip") is FakeDriver
        assert "fake_round_trip" in list_drivers()
        # Verify instance honours the abstract contract.
        inst = FakeDriver()
        assert isinstance(inst, PSUDriver)
        assert inst.idn() == "FAKE,X1,0,0"
    finally:
        # Clean up so registry tests stay independent.
        from backend.psu.registry import _REGISTRY  # type: ignore[attr-defined]
        _REGISTRY.pop("fake_round_trip", None)


def test_legacy_scpi_driver_symbol_still_importable() -> None:
    """The compatibility shim MUST keep working for legacy call sites."""
    from backend.scpi_driver import (
        BUFFER_SIZE,
        DEVICE_IP,
        DEVICE_PORT,
        TIMEOUT,
        SCPIDriver,
    )

    # SCPIDriver is now an alias for ITechPV6000Driver.
    assert SCPIDriver is ITechPV6000Driver
    assert DEVICE_IP == "192.168.200.100"
    assert DEVICE_PORT == 30000
    assert BUFFER_SIZE == 4096
    assert TIMEOUT == 5.0
