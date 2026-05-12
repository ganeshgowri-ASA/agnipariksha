"""Web Push (VAPID) — opt-in browser notifications for remote monitoring.

Endpoints
---------
- ``GET  /api/push/vapid-public-key``   → returns the server's VAPID public key
- ``POST /api/push/subscribe``          → registers a PushSubscription
- ``POST /api/push/unsubscribe``        → removes a registered endpoint
- ``POST /api/push/test``               → sends a probe notification to one or all subs

Subscriptions are persisted to ``logs/push_subs.json`` (atomic write).
Production deployments should swap this for the system-of-record DB.
"""
from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .auth import require_user
from .config import get_settings

router = APIRouter(prefix="/api/push", tags=["push"])

_STORE_LOCK = threading.Lock()


def _store_path() -> Path:
    s = get_settings()
    p = Path(s.LOG_DIR) / "push_subs.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _load_subs() -> List[Dict[str, Any]]:
    path = _store_path()
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return []


def _save_subs(subs: List[Dict[str, Any]]) -> None:
    path = _store_path()
    # Atomic write — write to tmp then rename.
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".push_subs.", suffix=".json")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(subs, f)
        os.replace(tmp, path)
    except OSError:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscription(BaseModel):
    endpoint: str
    keys: PushKeys
    user_agent: Optional[str] = None


class PushUnsubscribe(BaseModel):
    endpoint: str


@router.get("/vapid-public-key")
def vapid_public_key() -> Dict[str, str]:
    s = get_settings()
    return {"key": s.VAPID_PUBLIC_KEY}


@router.post("/subscribe")
def subscribe(sub: PushSubscription, _user=Depends(require_user)) -> Dict[str, Any]:
    record = sub.model_dump()
    with _STORE_LOCK:
        subs = _load_subs()
        # Upsert by endpoint.
        subs = [s for s in subs if s.get("endpoint") != record["endpoint"]]
        subs.append(record)
        _save_subs(subs)
    return {"ok": True, "count": len(subs)}


@router.post("/unsubscribe")
def unsubscribe(body: PushUnsubscribe, _user=Depends(require_user)) -> Dict[str, Any]:
    with _STORE_LOCK:
        subs = _load_subs()
        before = len(subs)
        subs = [s for s in subs if s.get("endpoint") != body.endpoint]
        _save_subs(subs)
    return {"ok": True, "removed": before - len(subs)}


class PushBroadcast(BaseModel):
    title: str = "Agnipariksha"
    body: str = "Test notification"
    url: Optional[str] = "/"


def _send_via_pywebpush(record: Dict[str, Any], payload: Dict[str, Any]) -> bool:
    s = get_settings()
    if not s.VAPID_PRIVATE_KEY:
        return False
    try:
        from pywebpush import WebPushException, webpush  # type: ignore
    except ImportError:
        return False
    try:
        webpush(
            subscription_info={
                "endpoint": record["endpoint"],
                "keys": record["keys"],
            },
            data=json.dumps(payload),
            vapid_private_key=s.VAPID_PRIVATE_KEY,
            vapid_claims={"sub": s.VAPID_SUBJECT},
        )
        return True
    except WebPushException:
        return False
    except Exception:
        return False


@router.post("/test")
def broadcast(body: PushBroadcast, _user=Depends(require_user)) -> Dict[str, Any]:
    s = get_settings()
    if not s.VAPID_PRIVATE_KEY:
        raise HTTPException(status_code=503, detail="VAPID keys not configured")
    with _STORE_LOCK:
        subs = list(_load_subs())
    sent = 0
    failed = 0
    payload = body.model_dump()
    for record in subs:
        if _send_via_pywebpush(record, payload):
            sent += 1
        else:
            failed += 1
    return {"ok": True, "sent": sent, "failed": failed, "subscribers": len(subs)}
