"""In-process event bus for remote monitoring (state / alarms / tickets).

A single process-wide ``EventBus`` fans events out to all connected
``/ws/events`` clients. Producers call :func:`publish_event` from anywhere
(SCPI loop, alarm handler, ticket endpoint).

Event payload shape::

    {"type": "state" | "alarm" | "ticket",
     "ts":    <unix ms>,
     "data":  {...}}
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, AsyncIterator, Dict


class EventBus:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue] = set()
        self._lock = asyncio.Lock()

    async def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        async with self._lock:
            self._subscribers.add(q)
        return q

    async def unsubscribe(self, q: asyncio.Queue) -> None:
        async with self._lock:
            self._subscribers.discard(q)

    async def publish(self, payload: Dict[str, Any]) -> None:
        if "ts" not in payload:
            payload = {**payload, "ts": int(time.time() * 1000)}
        # Snapshot under lock to avoid mutation-during-iter.
        async with self._lock:
            subs = list(self._subscribers)
        for q in subs:
            # Drop oldest on overflow rather than blocking publishers.
            if q.full():
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                pass

    async def stream(self, q: asyncio.Queue) -> AsyncIterator[Dict[str, Any]]:
        while True:
            yield await q.get()


_BUS: EventBus | None = None


def get_bus() -> EventBus:
    global _BUS
    if _BUS is None:
        _BUS = EventBus()
    return _BUS


async def publish_event(event_type: str, data: Dict[str, Any]) -> None:
    await get_bus().publish({"type": event_type, "data": data})
