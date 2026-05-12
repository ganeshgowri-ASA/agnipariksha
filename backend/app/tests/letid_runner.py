"""Singleton session registry and FastAPI/WebSocket bridge for LeTID.

Keeps a thin process-local map of running ``LeTIDOrchestrator``
instances so the HTTP control plane can start/stop/inspect sessions
and the WebSocket endpoint can stream events for a given session.
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, Optional

from .letid import LeTIDConfig, LeTIDOrchestrator, LeTIDResult

try:
    from backend.scpi_async import ScpiClient  # type: ignore
except ImportError:  # pragma: no cover
    from scpi_async import ScpiClient  # type: ignore


class _SessionEntry:
    def __init__(self, orchestrator: LeTIDOrchestrator) -> None:
        self.orchestrator = orchestrator
        self.subscribers: set[asyncio.Queue[dict]] = set()
        self.history: list[dict] = []  # capped event log for late subscribers

    async def broadcast(self, event: dict) -> None:
        self.history.append(event)
        if len(self.history) > 4096:
            self.history = self.history[-2048:]
        for q in list(self.subscribers):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass


class LeTIDRegistry:
    """Process-local registry — single-station deployment.

    For multi-station deployments swap this for a Redis/pubsub-backed
    implementation; the interface is intentionally small.
    """

    def __init__(self) -> None:
        self._sessions: Dict[str, _SessionEntry] = {}
        self._lock = asyncio.Lock()

    async def start(
        self,
        config: LeTIDConfig,
        demo_mode: Optional[bool] = None,
    ) -> str:
        client = ScpiClient(demo_mode=demo_mode)
        await client.connect()

        entry_holder: dict[str, _SessionEntry] = {}

        async def on_event(event: dict) -> None:
            entry = entry_holder.get("e")
            if entry is not None:
                await entry.broadcast(event)

        orch = LeTIDOrchestrator(client, config=config, on_event=on_event)
        entry = _SessionEntry(orch)
        entry_holder["e"] = entry
        async with self._lock:
            self._sessions[orch.session_id] = entry
        await orch.start()
        return orch.session_id

    def get(self, session_id: str) -> Optional[_SessionEntry]:
        return self._sessions.get(session_id)

    async def stop(self, session_id: str) -> Optional[LeTIDResult]:
        entry = self._sessions.get(session_id)
        if entry is None:
            return None
        return await entry.orchestrator.stop()

    def pause(self, session_id: str) -> bool:
        entry = self._sessions.get(session_id)
        if entry is None:
            return False
        entry.orchestrator.pause()
        return True

    def resume(self, session_id: str) -> bool:
        entry = self._sessions.get(session_id)
        if entry is None:
            return False
        entry.orchestrator.resume()
        return True

    def list_sessions(self) -> list[dict[str, Any]]:
        out = []
        for sid, entry in self._sessions.items():
            o = entry.orchestrator
            out.append({
                "session_id": sid,
                "running": o.running,
                "summary": o.result.summary(),
            })
        return out


_registry: Optional[LeTIDRegistry] = None


def get_registry() -> LeTIDRegistry:
    global _registry
    if _registry is None:
        _registry = LeTIDRegistry()
    return _registry
