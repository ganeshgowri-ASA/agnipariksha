"""Tests for the fail-fast / no-silent-demo behaviour of ScpiClient and the
/api/scpi router."""
from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

# Both names work whether tests are run from the repo root (``pytest``) or
# from inside backend/ (the CI smoke job).
try:
    from backend.main import app  # type: ignore[import-not-found]
    from backend.scpi_async import ScpiClient, ScpiUnreachable
    _PATCH_PREFIX = "backend."
except ImportError:  # pragma: no cover - script-mode fallback
    from main import app  # type: ignore[no-redef]
    from scpi_async import ScpiClient, ScpiUnreachable  # type: ignore[no-redef]
    _PATCH_PREFIX = ""


# --------------------------------------------------------------------------
# ScpiClient unit tests
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_query_demo_mode_still_simulates() -> None:
    """Demo mode keeps returning simulator data — no behaviour change."""
    client = ScpiClient(demo_mode=True)
    # connect() in demo mode is a no-op that returns False — never raises.
    assert await client.connect() is False
    idn = await client.query("*IDN?")
    assert "SIM" in idn or "DEMO" in idn  # simulator IDN includes one of these


@pytest.mark.asyncio
async def test_connect_live_mode_unreachable_raises() -> None:
    """Live mode + unreachable host MUST raise ScpiUnreachable, never silently fall back."""
    # Use a port that is guaranteed to be closed on loopback; with TimeoutError
    # path covered by patching open_connection.
    async def _refuse(*_args, **_kwargs):
        raise OSError(111, "Connection refused")

    with patch("asyncio.open_connection", side_effect=_refuse):
        client = ScpiClient(host="127.0.0.1", port=1, demo_mode=False)
        with pytest.raises(ScpiUnreachable) as ei:
            await client.connect(max_attempts=2)
        assert ei.value.host == "127.0.0.1"
        assert ei.value.port == 1
        assert "Connection refused" in ei.value.reason or "OSError" in ei.value.reason


@pytest.mark.asyncio
async def test_query_live_mode_without_connect_raises() -> None:
    """query() in live mode with no writer raises instead of silent simulator."""
    client = ScpiClient(host="127.0.0.1", port=1, demo_mode=False)
    # Deliberately skip connect() — _writer is None.
    with pytest.raises(ScpiUnreachable):
        await client.query("*IDN?")


@pytest.mark.asyncio
async def test_send_live_mode_without_connect_raises() -> None:
    """send() in live mode with no writer raises instead of silent simulator."""
    client = ScpiClient(host="127.0.0.1", port=1, demo_mode=False)
    with pytest.raises(ScpiUnreachable):
        await client.send("OUTP OFF")


# --------------------------------------------------------------------------
# Router HTTP tests
# --------------------------------------------------------------------------

class _FakeSettings:
    """Minimal stand-in for backend.config.Settings used by the router/driver.

    Only the attributes the SCPI code path reads; safer than a MagicMock so
    type comparisons stay deterministic.
    """
    def __init__(self, *, demo: bool, host: str = "192.168.200.100",
                 port: int = 30000, timeout_ms: int = 500) -> None:
        self.DEMO_MODE = demo
        self.ITECH_IP = host
        self.ITECH_PORT = port
        self.ITECH_TIMEOUT_MS = timeout_ms


def _patch_settings(*, demo: bool):
    """Patch get_settings everywhere it's imported (router + driver). The
    real get_settings is lru_cache'd so we have to rebind the function name
    in each module's local namespace rather than monkeypatch the cache."""
    fake = _FakeSettings(demo=demo)
    return [
        patch(f"{_PATCH_PREFIX}api.scpi_routes.get_settings", return_value=fake),
        patch(f"{_PATCH_PREFIX}scpi_async.get_settings", return_value=fake),
    ]


def test_router_idn_demo_mode_returns_200() -> None:
    """In demo mode, /api/scpi/idn returns 200 with the simulator IDN."""
    patches = _patch_settings(demo=True)
    for p in patches:
        p.start()
    try:
        with TestClient(app) as c:
            r = c.get("/api/scpi/idn")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["demo"] is True
            assert body["idn"]  # non-empty
            assert body["error"] is None
    finally:
        for p in patches:
            p.stop()


def test_router_query_demo_mode_returns_200() -> None:
    """In demo mode, /api/scpi/query?cmd=MEAS:VOLT? returns a simulated reading."""
    patches = _patch_settings(demo=True)
    for p in patches:
        p.start()
    try:
        with TestClient(app) as c:
            r = c.get("/api/scpi/query", params={"cmd": "MEAS:VOLT?"})
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["demo"] is True
            assert body["cmd"] == "MEAS:VOLT?"
            assert body["response"]  # non-empty simulator response
    finally:
        for p in patches:
            p.stop()


def test_router_idn_live_mode_unreachable_returns_503() -> None:
    """Live mode + unreachable hardware MUST surface 503, NOT mask with sim data."""
    async def _refuse(*_args, **_kwargs):
        raise OSError(111, "Connection refused")

    patches = _patch_settings(demo=False)
    open_patch = patch(f"{_PATCH_PREFIX}scpi_async.asyncio.open_connection", side_effect=_refuse)
    for p in patches:
        p.start()
    open_patch.start()
    try:
        with TestClient(app) as c:
            r = c.get("/api/scpi/idn")
            assert r.status_code == 503, r.text
            body = r.json()
            assert body["detail"]["error"] == "scpi_unreachable"
            assert body["detail"]["host"] == "192.168.200.100"
            assert body["detail"]["port"] == 30000
            assert "Connection refused" in body["detail"]["reason"] \
                or "OSError" in body["detail"]["reason"]
    finally:
        open_patch.stop()
        for p in patches:
            p.stop()


def test_router_query_live_mode_unreachable_returns_503() -> None:
    """Same fail-fast contract for /api/scpi/query."""
    async def _refuse(*_args, **_kwargs):
        raise OSError(111, "Connection refused")

    patches = _patch_settings(demo=False)
    open_patch = patch(f"{_PATCH_PREFIX}scpi_async.asyncio.open_connection", side_effect=_refuse)
    for p in patches:
        p.start()
    open_patch.start()
    try:
        with TestClient(app) as c:
            r = c.get("/api/scpi/query", params={"cmd": "MEAS:VOLT?"})
            assert r.status_code == 503, r.text
            body = r.json()
            assert body["detail"]["error"] == "scpi_unreachable"
    finally:
        open_patch.stop()
        for p in patches:
            p.stop()


def test_router_diag_demo_mode_returns_200() -> None:
    """/api/scpi/diag must never raise; in demo mode it still probes the
    real port (so a developer can sanity-check their lab even with DEMO=true)
    and reports source IP / OS error rather than masking with simulator data."""
    patches = _patch_settings(demo=True)
    for p in patches:
        p.start()
    try:
        with TestClient(app) as c:
            r = c.get("/api/scpi/diag")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["host"] == "192.168.200.100"
            assert body["port"] == 30000
            assert body["demo"] is True
            assert "reachable" in body
            assert "transport" in body
    finally:
        for p in patches:
            p.stop()


def test_router_diag_live_mode_unreachable_returns_200_with_error() -> None:
    """/api/scpi/diag is diagnostic — must return 200 even when the device
    is unreachable, so users on broken networks can still hit it."""
    patches = _patch_settings(demo=False)
    for p in patches:
        p.start()
    try:
        with TestClient(app) as c:
            # 192.0.2.0/24 is TEST-NET-1 (RFC 5737) — guaranteed unreachable.
            patch_settings = _FakeSettings(demo=False, host="192.0.2.1", port=1, timeout_ms=200)
            with patch(f"{_PATCH_PREFIX}api.scpi_routes.get_settings", return_value=patch_settings):
                r = c.get("/api/scpi/diag")
                assert r.status_code == 200, r.text
                body = r.json()
                assert body["reachable"] is False
                assert body["host"] == "192.0.2.1"
                # os_error is populated when reachable=False
                assert body["os_error"] is not None
    finally:
        for p in patches:
            p.stop()


# --------------------------------------------------------------------------
# /api/scpi/smoke
# --------------------------------------------------------------------------

def test_router_smoke_demo_returns_all_devices_ok() -> None:
    """In demo mode the smoke endpoint reports ok=true for every registered
    device. The 3 manifests we ship are itech_pv6000, dmm_keysight, chamber_espec
    — each transport's _demo_response yields a non-empty string."""
    patches = _patch_settings(demo=True)
    for p in patches:
        p.start()
    try:
        with TestClient(app) as c:
            r = c.get("/api/scpi/smoke")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["mode"] == "demo"
            assert body["ok"] is True
            ids = {d["id"] for d in body["devices"]}
            assert {"itech_pv6000", "dmm_keysight", "chamber_espec"}.issubset(ids)
            for d in body["devices"]:
                assert d["ok"] is True, f"{d['id']} should be ok in demo, got {d}"
                assert d["idn"], f"{d['id']} idn must be non-empty"
                assert d["error"] is None
                assert d["elapsed_ms"] >= 0
    finally:
        for p in patches:
            p.stop()


def test_router_smoke_always_200_in_live_mode_with_unreachable_hw() -> None:
    """Smoke endpoint must NEVER 5xx — per-device failures land inline so the
    UI can render a red lamp per device instead of "endpoint down"."""
    async def _refuse(*_args, **_kwargs):
        raise OSError(111, "Connection refused")

    patches = _patch_settings(demo=False)
    open_patch = patch(f"{_PATCH_PREFIX}scpi_async.asyncio.open_connection", side_effect=_refuse)
    # Also patch the device transports' open_connection (modbus_tcp uses it too).
    modbus_patch = patch(
        f"{_PATCH_PREFIX}app.transports.modbus_tcp.asyncio.open_connection",
        side_effect=_refuse,
    )
    for p in patches:
        p.start()
    open_patch.start()
    try:
        modbus_patch.start()
    except (ModuleNotFoundError, AttributeError):
        modbus_patch = None  # type: ignore[assignment]

    # Force every device into live mode so connect() is actually attempted.
    try:
        from backend.app.devices import get_registry
        from backend.app.devices.registry import _reset_registry_for_tests
    except ImportError:
        from app.devices import get_registry  # type: ignore[no-redef]
        from app.devices.registry import _reset_registry_for_tests  # type: ignore[no-redef]

    _reset_registry_for_tests()
    for d in get_registry().all():
        d.demo = False
        # Drop any cached transport so the new demo flag takes effect.
        d._transport_obj = None  # type: ignore[attr-defined]

    try:
        with TestClient(app) as c:
            r = c.get("/api/scpi/smoke")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["mode"] == "live"
            # Either every device fails, or any device that needs USBTMC may
            # also fail because the module isn't importable in CI — both are
            # acceptable. The contract under test is: 200 + structured payload.
            for d in body["devices"]:
                assert "id" in d and "ok" in d and "idn" in d
                if not d["ok"]:
                    assert d["error"] is not None
    finally:
        if modbus_patch is not None:
            modbus_patch.stop()
        open_patch.stop()
        for p in patches:
            p.stop()
        _reset_registry_for_tests()
