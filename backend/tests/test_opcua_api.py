"""Tests for the in-app OPC UA PSU dashboard REST proxy."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import backend.app.opcua_api as opcua_api  # noqa: E402
from backend.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_singletons():
    opcua_api.reset()
    yield
    opcua_api.reset()


def test_get_psu_exposes_readings_and_writable_allow_list() -> None:
    with TestClient(app) as c:
        r = c.get("/api/opcua/psu")
        assert r.status_code == 200
        body = r.json()
        assert body["mode"] == "DEMO"
        assert body["model"] == "ITECH PV6000"
        for key in ("voltage_v", "current_a", "power_w", "temperature_c"):
            assert isinstance(body[key], (int, float))
        assert set(body["writable_nodes"]) == {
            "Voltage_Setpoint_V",
            "Current_Setpoint_A",
            "Output_Enabled",
        }


def test_setpoint_then_poll_tracks_command() -> None:
    with TestClient(app) as c:
        r = c.post(
            "/api/opcua/psu/setpoints",
            json={"voltage_v": 48.0, "current_a": 2.0, "output_enabled": True},
        )
        assert r.status_code == 200
        v = 0.0
        for _ in range(40):  # each GET advances the DEMO sim one tick
            v = c.get("/api/opcua/psu").json()["voltage_v"]
        assert v == pytest.approx(48.0, abs=0.5)


def test_setpoint_validation_rejects_negative_current() -> None:
    with TestClient(app) as c:
        r = c.post(
            "/api/opcua/psu/setpoints",
            json={"voltage_v": 12.0, "current_a": -1.0, "output_enabled": True},
        )
        assert r.status_code == 422
