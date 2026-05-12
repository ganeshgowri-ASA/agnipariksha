"""Periodic device health-check task.

Runs as a background asyncio task started during FastAPI lifespan. Every
``HEALTH_INTERVAL_S`` seconds the task asks each device for liveness and
writes the result into the device record (and the DB, when wired).
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Optional

from .devices import get_registry
from .devices.registry import Device

HEALTH_INTERVAL_S = 10.0

_LOG = logging.getLogger("agnipariksha.health")


async def _persist_health(device: Device) -> None:
    """Best-effort persistence to TimescaleDB.

    Schema is created lazily; failures are logged and swallowed so the
    health loop keeps running even on dev boxes without Postgres.
    """
    try:
        # Package mode: backend.database. Script mode (uvicorn run from
        # inside backend/): top-level database. Try both.
        try:
            from backend import database  # type: ignore
        except ImportError:
            import database  # type: ignore[no-redef]
    except ImportError:
        return
    pool = getattr(database, "pool", None)
    if not pool:
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS device_health (
                    device_id   TEXT NOT NULL,
                    ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    state       TEXT NOT NULL,
                    alive       BOOLEAN NOT NULL,
                    last_error  TEXT,
                    PRIMARY KEY (device_id, ts)
                );
                """
            )
            await conn.execute(
                """
                INSERT INTO device_health (device_id, state, alive, last_error)
                VALUES ($1, $2, $3, $4)
                """,
                device.id,
                device.health.get("state", "unknown"),
                bool(device.health.get("alive")),
                device.health.get("last_error"),
            )
    except Exception as exc:  # noqa: BLE001
        _LOG.debug("device_health persistence skipped: %s", exc)


async def _check_one(device: Device) -> None:
    transport = device.get_transport()
    if transport.state.value in ("init", "closed", "down") and not device.demo:
        await transport.connect(max_attempts=1)
    alive = await transport.is_alive()
    device.health = {
        "alive": alive,
        "state": transport.state.value,
        "last_error": transport.last_error,
        "last_alive_ms": transport.last_alive_ms,
        "checked_ms": int(time.time() * 1000),
    }
    await _persist_health(device)


async def health_loop(interval_s: float = HEALTH_INTERVAL_S) -> None:
    """Run forever, polling each device's ``is_alive`` every ``interval_s``."""
    registry = get_registry()
    while True:
        for device in registry.all():
            try:
                await _check_one(device)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — health must never crash
                _LOG.warning("health check failed for %s: %s", device.id, exc)
                device.health = {
                    "alive": False,
                    "state": "down",
                    "last_error": f"{type(exc).__name__}: {exc}",
                    "checked_ms": int(time.time() * 1000),
                }
        await asyncio.sleep(interval_s)


_TASK: Optional[asyncio.Task[Any]] = None


def start_background_health(loop_interval_s: float = HEALTH_INTERVAL_S) -> asyncio.Task[Any]:
    global _TASK
    if _TASK is None or _TASK.done():
        _TASK = asyncio.create_task(health_loop(loop_interval_s), name="device-health-loop")
    return _TASK


async def stop_background_health() -> None:
    global _TASK
    if _TASK is None:
        return
    _TASK.cancel()
    try:
        await _TASK
    except (asyncio.CancelledError, Exception):
        pass
    _TASK = None
