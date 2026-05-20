"""Tests for the IEC TS 60904-13 EL imaging stub (DEMO-only)."""
from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.el.camera import DEFAULT_HEIGHT, DEFAULT_WIDTH, SimulatedELCamera
from backend.el.orchestrator import run_el_capture
from backend.main import app


class _FakeSettings:
    def __init__(self, demo: bool) -> None:
        self.DEMO_MODE = demo


client = TestClient(app)
_GOOD = {"module_id": "MOD-001", "isc_a": 9.5, "exposure_ms": 500, "gain": 1.0}


def test_capture_demo_returns_expected_shape() -> None:
    r = client.post("/api/el/capture", json=_GOOD)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["demo"] is True
    assert body["module_id"] == "MOD-001"
    assert body["frame_shape"] == [DEFAULT_HEIGHT, DEFAULT_WIDTH]
    assert body["image_path"].endswith(".png")


def test_capture_live_mode_refused_with_503() -> None:
    with patch("backend.el.router.get_settings", return_value=_FakeSettings(demo=False)):
        r = client.post("/api/el/capture", json=_GOOD)
    assert r.status_code == 503
    assert r.json()["detail"]["error"] == "el_capture_disabled_in_live_mode"


def test_capture_rejects_non_positive_exposure() -> None:
    bad = {**_GOOD, "exposure_ms": 0}
    assert client.post("/api/el/capture", json=bad).status_code == 422


def test_capture_rejects_invalid_module_id() -> None:
    bad = {**_GOOD, "module_id": "bad id!"}
    # Pydantic Field(min_length=1) lets it through; orchestrator regex rejects.
    assert client.post("/api/el/capture", json=bad).status_code == 422


def test_camera_live_mode_not_implemented() -> None:
    with pytest.raises(NotImplementedError):
        SimulatedELCamera(demo_mode=False)


def test_orchestrator_demo_assert_fires_in_live_mode() -> None:
    with patch("backend.el.orchestrator.get_settings", return_value=_FakeSettings(demo=False)):
        with pytest.raises(AssertionError):
            run_el_capture("MOD-X", isc_a=9.0, exposure_ms=500, gain=1.0)
