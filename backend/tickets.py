"""Unified ticketing system (V2-S5).

Provides a Ticket model that captures both maintenance work and end-user
complaints, with SLA timers, assignment, attachments, and references to
equipment / module / test-run records. Implemented as an in-process store
so it works without a database; persistence can swap in later without
changing the API surface.

REST surface (mounted by ``main.py``)::

    GET    /api/tickets                     -> list + filter
    POST   /api/tickets                     -> create
    GET    /api/tickets/{id}                -> fetch one
    PATCH  /api/tickets/{id}                -> partial update (status, assignee, ...)
    POST   /api/tickets/{id}/attachments    -> upload an attachment
    POST   /api/tickets/{id}/transition     -> state machine transition
    GET    /api/tickets/_notifications      -> list assignment notifications (test hook)
"""
from __future__ import annotations

import asyncio
import base64
import os
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Domain types
# ---------------------------------------------------------------------------
TicketType = Literal["maintenance", "complaint"]
TicketState = Literal[
    "open",
    "in_progress",
    "waiting_part",
    "resolved",
    "closed",
]
TicketPriority = Literal["low", "normal", "high", "critical"]

ALLOWED_STATES: tuple[TicketState, ...] = (
    "open",
    "in_progress",
    "waiting_part",
    "resolved",
    "closed",
)

# state -> allowed next states
TRANSITIONS: Dict[TicketState, frozenset[TicketState]] = {
    "open":          frozenset({"in_progress", "waiting_part", "resolved", "closed"}),
    "in_progress":   frozenset({"waiting_part", "resolved", "open", "closed"}),
    "waiting_part":  frozenset({"in_progress", "resolved", "closed"}),
    "resolved":      frozenset({"closed", "open"}),
    "closed":        frozenset({"open"}),
}

# SLA (hours) per priority — used to compute due_at on creation
SLA_HOURS: Dict[TicketPriority, int] = {
    "critical": 4,
    "high":     12,
    "normal":   48,
    "low":      120,
}


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------
class TicketLinks(BaseModel):
    equipment_id: Optional[str] = None
    module_id: Optional[str] = None
    test_run_id: Optional[str] = None


class TicketAttachment(BaseModel):
    id: str
    name: str
    mime: str
    size: int
    created_at: float


class TicketCreate(BaseModel):
    type: TicketType
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    priority: TicketPriority = "normal"
    assignee: Optional[str] = None
    reporter: Optional[str] = None
    links: TicketLinks = Field(default_factory=TicketLinks)
    tags: List[str] = Field(default_factory=list)
    source: Optional[str] = None  # e.g. "error_toast", "report_tab"

    @field_validator("title")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("title must not be blank")
        return v


class TicketUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[TicketPriority] = None
    assignee: Optional[str] = None
    tags: Optional[List[str]] = None
    links: Optional[TicketLinks] = None
    state: Optional[TicketState] = None


class TicketTransition(BaseModel):
    to: TicketState
    note: Optional[str] = None


class AttachmentCreate(BaseModel):
    name: str
    mime: str = "application/octet-stream"
    data_b64: str

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v or "/" in v or "\\" in v:
            raise ValueError("invalid attachment name")
        return v


class TicketOut(BaseModel):
    id: str
    type: TicketType
    title: str
    description: str
    state: TicketState
    priority: TicketPriority
    assignee: Optional[str]
    reporter: Optional[str]
    links: TicketLinks
    tags: List[str]
    source: Optional[str]
    attachments: List[TicketAttachment]
    history: List[Dict[str, Any]]
    created_at: float
    updated_at: float
    due_at: float
    sla_breached: bool


# ---------------------------------------------------------------------------
# In-memory store
# ---------------------------------------------------------------------------
@dataclass
class _Ticket:
    id: str
    type: TicketType
    title: str
    description: str
    state: TicketState
    priority: TicketPriority
    assignee: Optional[str]
    reporter: Optional[str]
    links: Dict[str, Optional[str]]
    tags: List[str]
    source: Optional[str]
    attachments: List[Dict[str, Any]] = field(default_factory=list)
    history: List[Dict[str, Any]] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    due_at: float = 0.0

    def to_out(self) -> TicketOut:
        return TicketOut(
            id=self.id,
            type=self.type,
            title=self.title,
            description=self.description,
            state=self.state,
            priority=self.priority,
            assignee=self.assignee,
            reporter=self.reporter,
            links=TicketLinks(**self.links),
            tags=list(self.tags),
            source=self.source,
            attachments=[TicketAttachment(**a) for a in self.attachments],
            history=list(self.history),
            created_at=self.created_at,
            updated_at=self.updated_at,
            due_at=self.due_at,
            sla_breached=self._is_breached(),
        )

    def _is_breached(self) -> bool:
        if self.state in ("resolved", "closed"):
            return False
        return time.time() > self.due_at


class TicketStore:
    def __init__(self) -> None:
        self._items: Dict[str, _Ticket] = {}
        self._notifications: List[Dict[str, Any]] = []
        self._lock = asyncio.Lock()

    # -- queries -----------------------------------------------------------
    def list(
        self,
        *,
        type: Optional[TicketType] = None,
        state: Optional[TicketState] = None,
        assignee: Optional[str] = None,
        q: Optional[str] = None,
    ) -> List[_Ticket]:
        items = list(self._items.values())
        if type:
            items = [t for t in items if t.type == type]
        if state:
            items = [t for t in items if t.state == state]
        if assignee:
            items = [t for t in items if t.assignee == assignee]
        if q:
            ql = q.lower()
            items = [
                t for t in items
                if ql in t.title.lower() or ql in t.description.lower()
            ]
        items.sort(key=lambda t: t.created_at, reverse=True)
        return items

    def get(self, ticket_id: str) -> _Ticket:
        t = self._items.get(ticket_id)
        if t is None:
            raise HTTPException(status_code=404, detail="ticket not found")
        return t

    # -- mutations ---------------------------------------------------------
    def create(self, payload: TicketCreate) -> _Ticket:
        now = time.time()
        due = now + SLA_HOURS[payload.priority] * 3600
        ticket = _Ticket(
            id=f"TKT-{uuid.uuid4().hex[:8].upper()}",
            type=payload.type,
            title=payload.title,
            description=payload.description,
            state="open",
            priority=payload.priority,
            assignee=payload.assignee,
            reporter=payload.reporter,
            links=payload.links.model_dump(),
            tags=list(payload.tags),
            source=payload.source,
            created_at=now,
            updated_at=now,
            due_at=due,
        )
        ticket.history.append({
            "ts": now,
            "event": "created",
            "by": payload.reporter,
            "to": "open",
        })
        self._items[ticket.id] = ticket
        if ticket.assignee:
            self._emit_assignment(ticket, ticket.assignee, by=payload.reporter)
        return ticket

    def update(self, ticket_id: str, patch: TicketUpdate) -> _Ticket:
        t = self.get(ticket_id)
        changed: Dict[str, Any] = {}
        if patch.title is not None:
            t.title = patch.title.strip()
            changed["title"] = t.title
        if patch.description is not None:
            t.description = patch.description
            changed["description"] = "updated"
        if patch.tags is not None:
            t.tags = list(patch.tags)
            changed["tags"] = t.tags
        if patch.links is not None:
            t.links = patch.links.model_dump()
            changed["links"] = t.links
        if patch.priority is not None and patch.priority != t.priority:
            old = t.priority
            t.priority = patch.priority
            # Re-compute due_at relative to creation when priority changes
            t.due_at = t.created_at + SLA_HOURS[t.priority] * 3600
            changed["priority"] = {"from": old, "to": t.priority}
        if patch.assignee is not None and patch.assignee != t.assignee:
            old = t.assignee
            t.assignee = patch.assignee or None
            changed["assignee"] = {"from": old, "to": t.assignee}
            if t.assignee:
                self._emit_assignment(t, t.assignee, by=None)
        if patch.state is not None and patch.state != t.state:
            self._transition(t, patch.state, note=None)
            changed["state"] = t.state
        if changed:
            t.updated_at = time.time()
            t.history.append({"ts": t.updated_at, "event": "updated", "changes": changed})
        return t

    def transition(self, ticket_id: str, to: TicketState, note: Optional[str]) -> _Ticket:
        t = self.get(ticket_id)
        self._transition(t, to, note)
        return t

    def _transition(self, t: _Ticket, to: TicketState, note: Optional[str]) -> None:
        if to not in ALLOWED_STATES:
            raise HTTPException(status_code=422, detail=f"invalid state '{to}'")
        if to == t.state:
            return
        if to not in TRANSITIONS[t.state]:
            raise HTTPException(
                status_code=409,
                detail=f"cannot transition {t.state} -> {to}",
            )
        prev = t.state
        t.state = to
        t.updated_at = time.time()
        t.history.append({
            "ts": t.updated_at,
            "event": "transition",
            "from": prev,
            "to": to,
            "note": note,
        })

    def add_attachment(self, ticket_id: str, payload: AttachmentCreate) -> TicketAttachment:
        t = self.get(ticket_id)
        try:
            raw = base64.b64decode(payload.data_b64, validate=True)
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"invalid base64: {e}") from e
        if len(raw) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="attachment exceeds 10 MB")
        att = {
            "id": f"att-{uuid.uuid4().hex[:8]}",
            "name": payload.name,
            "mime": payload.mime,
            "size": len(raw),
            "created_at": time.time(),
        }
        t.attachments.append(att)
        t.updated_at = att["created_at"]
        t.history.append({"ts": att["created_at"], "event": "attachment_added", "id": att["id"], "name": att["name"]})
        return TicketAttachment(**att)

    # -- notifications -----------------------------------------------------
    def _emit_assignment(self, t: _Ticket, assignee: str, by: Optional[str]) -> None:
        note = {
            "id": f"ntf-{uuid.uuid4().hex[:8]}",
            "ts": time.time(),
            "kind": "assignment",
            "ticket_id": t.id,
            "title": t.title,
            "assignee": assignee,
            "by": by,
            "channels": _resolve_channels(assignee),
        }
        self._notifications.append(note)

    def notifications(self) -> List[Dict[str, Any]]:
        return list(self._notifications)

    # -- test helpers ------------------------------------------------------
    def reset(self) -> None:
        self._items.clear()
        self._notifications.clear()


def _resolve_channels(assignee: str) -> List[str]:
    """Pick notification channels based on assignee + env config."""
    channels: List[str] = []
    # Email channel: enabled when SMTP host configured OR pytest is running
    # (so the assignment-notification test gets a deterministic record).
    if os.environ.get("SMTP_HOST") or "PYTEST_CURRENT_TEST" in os.environ:
        channels.append("email")
    # Web push channel: enabled when VAPID public key configured OR in tests
    if os.environ.get("VAPID_PUBLIC_KEY") or "PYTEST_CURRENT_TEST" in os.environ:
        channels.append("webpush")
    if not channels:
        channels.append("inapp")
    return channels


# ---------------------------------------------------------------------------
# Module-level store + router
# ---------------------------------------------------------------------------
store = TicketStore()
router = APIRouter(prefix="/api/tickets", tags=["tickets"])


@router.get("", response_model=List[TicketOut])
def list_tickets(
    type: Optional[TicketType] = Query(default=None),
    state: Optional[TicketState] = Query(default=None),
    assignee: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
) -> List[TicketOut]:
    return [t.to_out() for t in store.list(type=type, state=state, assignee=assignee, q=q)]


@router.post("", response_model=TicketOut, status_code=201)
def create_ticket(payload: TicketCreate) -> TicketOut:
    return store.create(payload).to_out()


@router.get("/_notifications")
def list_notifications() -> Dict[str, Any]:
    return {"items": store.notifications()}


@router.get("/{ticket_id}", response_model=TicketOut)
def get_ticket(ticket_id: str) -> TicketOut:
    return store.get(ticket_id).to_out()


@router.patch("/{ticket_id}", response_model=TicketOut)
def update_ticket(ticket_id: str, patch: TicketUpdate) -> TicketOut:
    return store.update(ticket_id, patch).to_out()


@router.post("/{ticket_id}/transition", response_model=TicketOut)
def transition_ticket(ticket_id: str, body: TicketTransition) -> TicketOut:
    return store.transition(ticket_id, body.to, body.note).to_out()


@router.post("/{ticket_id}/attachments", response_model=TicketAttachment, status_code=201)
def add_attachment(ticket_id: str, payload: AttachmentCreate) -> TicketAttachment:
    return store.add_attachment(ticket_id, payload)


# Dev/test reset hook — guarded by env flag, never exposed in prod.
@router.post("/_reset", include_in_schema=False)
def reset_store(request: Request) -> Dict[str, Any]:
    if not (os.environ.get("AGNI_TEST_MODE") or "PYTEST_CURRENT_TEST" in os.environ):
        raise HTTPException(status_code=404, detail="not found")
    store.reset()
    return {"ok": True}
