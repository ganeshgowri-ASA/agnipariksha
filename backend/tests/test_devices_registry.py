"""Device registry + health-loop tests."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.devices.registry import (  # noqa: E402
    Device,
    DeviceRegistry,
    _parse_yaml_minimal,
    load_devices,
)
from backend.app.health import _check_one  # noqa: E402


def test_load_devices_finds_itech_pv6000() -> None:
    reg = load_devices(Path(__file__).resolve().parents[1] / "app" / "devices")
    itech = reg.get("itech_pv6000")
    assert itech is not None
    assert itech.transport_kind == "scpi_tcp"
    assert itech.transport_opts["host"] == "192.168.200.100"
    assert itech.transport_opts["port"] == 30000
    assert "IEC 61215" in itech.standards


def test_load_devices_includes_all_three_manifests() -> None:
    reg = load_devices(Path(__file__).resolve().parents[1] / "app" / "devices")
    ids = {d.id for d in reg.all()}
    assert {"itech_pv6000", "chamber_espec", "dmm_keysight"}.issubset(ids)


def test_parse_yaml_minimal_handles_nested_and_lists() -> None:
    text = """
id: x
name: X
transport:
  kind: scpi_tcp
  host: 1.2.3.4
  port: 30000
standards: [a, b, c]
demo: true
"""
    data = _parse_yaml_minimal(text)
    assert data["id"] == "x"
    assert data["transport"]["host"] == "1.2.3.4"
    assert data["transport"]["port"] == 30000
    assert data["standards"] == ["a", "b", "c"]
    assert data["demo"] is True


def test_device_from_dict_round_trip() -> None:
    d = Device.from_dict({
        "id": "x", "name": "X", "role": "dc_source",
        "vendor": "ACME", "model": "M1",
        "transport": {"kind": "scpi_tcp", "host": "h", "port": 1},
        "demo": False,
    })
    assert d.id == "x"
    assert d.demo is False
    out = d.to_dict()
    assert out["transport"]["kind"] == "scpi_tcp"


def test_registry_to_list_serialises_health() -> None:
    reg = DeviceRegistry([
        Device(
            id="a", name="A", role="dc_source", vendor="v", model="m",
            transport_kind="scpi_tcp", transport_opts={"host": "h", "port": 1},
            demo=True,
        ),
    ])
    reg.get("a").health = {"alive": True}  # type: ignore[union-attr]
    serialised = reg.to_list()
    assert serialised[0]["health"]["alive"] is True


@pytest.mark.asyncio
async def test_health_check_one_demo_marks_alive() -> None:
    d = Device(
        id="d1", name="D1", role="dc_source", vendor="v", model="m",
        transport_kind="scpi_tcp", transport_opts={"host": "h", "port": 1},
        demo=True,
    )
    await _check_one(d)
    assert d.health["alive"] is True
    assert d.health["state"] == "demo"


@pytest.mark.asyncio
async def test_health_check_one_unreachable_marks_down() -> None:
    d = Device(
        id="d2", name="D2", role="dc_source", vendor="v", model="m",
        transport_kind="scpi_tcp", transport_opts={"host": "127.0.0.1", "port": 1},
        demo=False,
    )
    # Speed up the connect path so this test doesn't drag.
    transport = d.get_transport()
    transport.BASE_BACKOFF_S = 0
    transport.MAX_BACKOFF_S = 0
    await _check_one(d)
    assert d.health["alive"] is False
    assert d.health["state"] in ("down", "init", "closed")
