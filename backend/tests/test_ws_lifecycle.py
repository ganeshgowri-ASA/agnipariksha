"""WebSocket lifecycle regression tests (Issues #100 / #98).

A client disconnecting mid-stream must never leave the telemetry tasks
calling ``ws.send_text`` on a closed socket — that was the source of the
``Unexpected ASGI message 'websocket.send', after sending 'websocket.close'``
RuntimeError that spammed the uvicorn log on every reconnect.
"""
from __future__ import annotations

import asyncio

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketState

from backend.main import _safe_send, _ws_connected, app

client = TestClient(app)


class _FakeWS:
    """Minimal stand-in for the send surface of a Starlette WebSocket."""

    def __init__(
        self,
        *,
        app_state: WebSocketState = WebSocketState.CONNECTED,
        client_state: WebSocketState = WebSocketState.CONNECTED,
        raise_exc: BaseException | None = None,
    ) -> None:
        self.application_state = app_state
        self.client_state = client_state
        self._raise_exc = raise_exc
        self.sent: list[str] = []

    async def send_text(self, text: str) -> None:
        if self._raise_exc is not None:
            raise self._raise_exc
        self.sent.append(text)


async def test_safe_send_happy_path_sends_and_returns_true() -> None:
    ws = _FakeWS()
    stop = asyncio.Event()
    assert await _safe_send(ws, stop, "hi") is True
    assert ws.sent == ["hi"]
    assert not stop.is_set()
    assert _ws_connected(ws) is True


async def test_safe_send_swallows_send_after_close_runtimeerror() -> None:
    # The exact RuntimeError uvicorn raises when the app sends post-close.
    exc = RuntimeError(
        "Unexpected ASGI message 'websocket.send', after sending "
        "'websocket.close' or response already completed"
    )
    ws = _FakeWS(raise_exc=exc)
    stop = asyncio.Event()
    assert await _safe_send(ws, stop, "late") is False
    assert stop.is_set()  # trips the stop signal so producers wind down


async def test_safe_send_skips_send_when_client_disconnected() -> None:
    ws = _FakeWS(client_state=WebSocketState.DISCONNECTED)
    stop = asyncio.Event()
    assert await _safe_send(ws, stop, "x") is False
    assert ws.sent == []  # never touches a known-closed socket
    assert stop.is_set()


async def test_safe_send_is_noop_once_stopped() -> None:
    ws = _FakeWS()
    stop = asyncio.Event()
    stop.set()
    assert await _safe_send(ws, stop, "x") is False
    assert ws.sent == []


def test_ws_live_disconnect_midstream_then_reconnects() -> None:
    """Disconnecting mid-stream must tear the endpoint down cleanly so a
    fresh client can still connect and stream (no wedged task, no 500)."""
    for _ in range(3):
        with client.websocket_connect("/ws/live") as ws:
            msg = ws.receive_json()
            assert "V" in msg and "I" in msg
        # Leaving the block disconnects mid-stream; the loop must stop.


def test_ws_telemetry_disconnect_midstream_then_reconnects() -> None:
    for _ in range(3):
        with client.websocket_connect("/ws/telemetry?interval=0.05") as ws:
            msg = ws.receive_json()
            assert "V" in msg and "I" in msg
