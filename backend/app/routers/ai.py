"""AI thread CRUD + SSE streaming ``/api/ai/ask`` endpoint."""
from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session, session_scope
from ..models import AIMessage, AIThread, Module, TestRun
from ..ai import tools as agent_tools
from ..ai.agent import AgentContext, run_agent_stream, summarise_telemetry

router = APIRouter(prefix="/api/ai", tags=["ai"])


# ---------------------------------------------------------------------------
# Threads CRUD
# ---------------------------------------------------------------------------
class ThreadIn(BaseModel):
    module_id: Optional[str] = None
    run_id: Optional[str] = None
    tab_context: str = ""
    title: str = "New conversation"


class ThreadPatch(BaseModel):
    module_id: Optional[str] = None
    run_id: Optional[str] = None
    tab_context: Optional[str] = None
    title: Optional[str] = None


class MessageOut(BaseModel):
    id: int
    role: str
    content: str
    citations: list[dict[str, Any]]
    tool_calls: list[dict[str, Any]]
    created_at: str


class ThreadOut(BaseModel):
    thread_id: str
    module_id: Optional[str]
    run_id: Optional[str]
    tab_context: str
    title: str
    created_at: str
    updated_at: str
    messages: list[MessageOut] = []


def _msg_out(m: AIMessage) -> MessageOut:
    return MessageOut(
        id=m.id or 0,
        role=m.role,
        content=m.content,
        citations=m.citations,
        tool_calls=m.tool_calls,
        created_at=m.created_at.isoformat() if m.created_at else "",
    )


def _thread_out(t: AIThread, messages: list[AIMessage]) -> ThreadOut:
    return ThreadOut(
        thread_id=t.thread_id,
        module_id=t.module_id,
        run_id=t.run_id,
        tab_context=t.tab_context,
        title=t.title,
        created_at=t.created_at.isoformat(),
        updated_at=t.updated_at.isoformat(),
        messages=[_msg_out(m) for m in messages],
    )


@router.get("/threads", response_model=list[ThreadOut])
def list_threads(
    module_id: Optional[str] = None,
    s: Session = Depends(get_session),
) -> list[ThreadOut]:
    stmt = select(AIThread)
    if module_id:
        stmt = stmt.where(AIThread.module_id == module_id)
    rows = s.exec(stmt.order_by(AIThread.updated_at.desc())).all()
    return [_thread_out(t, []) for t in rows]


@router.post("/threads", response_model=ThreadOut, status_code=201)
def create_thread(payload: ThreadIn, s: Session = Depends(get_session)) -> ThreadOut:
    t = AIThread(
        module_id=payload.module_id,
        run_id=payload.run_id,
        tab_context=payload.tab_context,
        title=payload.title or "New conversation",
    )
    s.add(t)
    s.commit()
    s.refresh(t)
    return _thread_out(t, [])


@router.get("/threads/{thread_id}", response_model=ThreadOut)
def get_thread(thread_id: str, s: Session = Depends(get_session)) -> ThreadOut:
    t = s.get(AIThread, thread_id)
    if not t:
        raise HTTPException(status_code=404, detail="thread_not_found")
    msgs = s.exec(
        select(AIMessage).where(AIMessage.thread_id == thread_id).order_by(AIMessage.id.asc())
    ).all()
    return _thread_out(t, msgs)


@router.patch("/threads/{thread_id}", response_model=ThreadOut)
def patch_thread(thread_id: str, patch: ThreadPatch, s: Session = Depends(get_session)) -> ThreadOut:
    t = s.get(AIThread, thread_id)
    if not t:
        raise HTTPException(status_code=404, detail="thread_not_found")
    if patch.module_id is not None:
        t.module_id = patch.module_id
    if patch.run_id is not None:
        t.run_id = patch.run_id
    if patch.tab_context is not None:
        t.tab_context = patch.tab_context
    if patch.title is not None:
        t.title = patch.title
    t.updated_at = datetime.utcnow()
    s.add(t)
    s.commit()
    s.refresh(t)
    return _thread_out(t, [])


@router.delete("/threads/{thread_id}", status_code=204)
def delete_thread(thread_id: str, s: Session = Depends(get_session)) -> None:
    t = s.get(AIThread, thread_id)
    if not t:
        raise HTTPException(status_code=404, detail="thread_not_found")
    msgs = s.exec(select(AIMessage).where(AIMessage.thread_id == thread_id)).all()
    for m in msgs:
        s.delete(m)
    s.delete(t)
    s.commit()


# ---------------------------------------------------------------------------
# Ask — SSE streaming
# ---------------------------------------------------------------------------
class AskIn(BaseModel):
    thread_id: str
    message: str
    tab_context: Optional[str] = None
    module_id: Optional[str] = None
    run_id: Optional[str] = None
    live_telemetry: Optional[list[dict[str, Any]]] = None


def _build_context(
    *,
    s: Session,
    thread: AIThread,
    tab: str,
    module_id: Optional[str],
    run_id: Optional[str],
    live_telemetry: Optional[list[dict[str, Any]]],
) -> AgentContext:
    ctx = AgentContext(tab=tab)

    mid = module_id or thread.module_id
    rid = run_id or thread.run_id

    if mid:
        m = s.get(Module, mid)
        if m:
            ctx.module = agent_tools._module_payload(m)  # type: ignore[attr-defined]

    if rid:
        r = s.get(TestRun, rid)
        if r:
            ctx.run = agent_tools._run_payload(r)  # type: ignore[attr-defined]
            # Last 60 s telemetry summary, from live payload if given,
            # otherwise from persisted samples.
            stored = r.telemetry
            if live_telemetry:
                cutoff = time.time() - 60.0
                recent = [p for p in live_telemetry if p.get("t", 0) >= cutoff]
                if not recent and live_telemetry:
                    recent = live_telemetry[-200:]
                ctx.telemetry_summary = summarise_telemetry(recent)
            elif stored:
                ctx.telemetry_summary = summarise_telemetry(stored[-200:])

    # Clause lookup — by tab context, or by run.test_type.
    clause_key = None
    if ctx.run and ctx.run.get("iec_clause"):
        clause_key = ctx.run["iec_clause"]
    else:
        clause_key = {
            "tc": "MQT11",
            "hf": "MQT12",
            "dh": "MQT13",
            "bdt": "MQT18",
            "letid": "TS63342",
            "rco": "MST26",
            "gct": "MST13",
        }.get(tab or "")
    if clause_key:
        out = agent_tools.get_iec_clause(clause_key)
        if "error" not in out:
            ctx.clause = out

    return ctx


@router.post("/ask")
async def ask(payload: AskIn, request: Request) -> StreamingResponse:
    with session_scope() as s:
        thread = s.get(AIThread, payload.thread_id)
        if not thread:
            raise HTTPException(status_code=404, detail="thread_not_found")
        # Persist user message immediately.
        user_msg = AIMessage(thread_id=thread.thread_id, role="user", content=payload.message)
        s.add(user_msg)
        if payload.module_id is not None:
            thread.module_id = payload.module_id
        if payload.run_id is not None:
            thread.run_id = payload.run_id
        if payload.tab_context is not None:
            thread.tab_context = payload.tab_context
        thread.updated_at = datetime.utcnow()
        s.add(thread)
        s.commit()
        s.refresh(thread)

        ctx = _build_context(
            s=s,
            thread=thread,
            tab=payload.tab_context or thread.tab_context,
            module_id=payload.module_id,
            run_id=payload.run_id,
            live_telemetry=payload.live_telemetry,
        )
        history_rows = s.exec(
            select(AIMessage).where(AIMessage.thread_id == thread.thread_id).order_by(AIMessage.id.asc())
        ).all()
        history = [{"role": m.role, "content": m.content} for m in history_rows if m.role in ("user", "assistant")]
        # Drop the just-added user message (will be appended by the agent).
        if history and history[-1]["role"] == "user" and history[-1]["content"] == payload.message:
            history = history[:-1]

    async def event_stream():
        final_text = ""
        citations: list[dict[str, Any]] = []
        tool_calls: list[dict[str, Any]] = []
        try:
            async for ev in run_agent_stream(history=history, user_text=payload.message, context=ctx):
                if ev.get("type") == "delta":
                    final_text += ev.get("text", "")
                elif ev.get("type") == "tool_call":
                    tool_calls.append({"name": ev.get("name"), "input": ev.get("input")})
                elif ev.get("type") == "tool_result":
                    if tool_calls and tool_calls[-1].get("name") == ev.get("name"):
                        tool_calls[-1]["output"] = ev.get("output")
                elif ev.get("type") == "citation":
                    citations.append({"clause_id": ev.get("clause_id"), "title": ev.get("title", "")})
                elif ev.get("type") == "done":
                    if not final_text:
                        final_text = ev.get("text", "")
                yield f"event: {ev.get('type')}\ndata: {json.dumps(ev)}\n\n"
                # Yield control so SSE can flush.
                await asyncio.sleep(0)
        finally:
            # Persist assistant turn.
            with session_scope() as s:
                msg = AIMessage(thread_id=payload.thread_id, role="assistant", content=final_text)
                msg.citations = citations
                msg.tool_calls = tool_calls
                s.add(msg)
                t = s.get(AIThread, payload.thread_id)
                if t:
                    t.updated_at = datetime.utcnow()
                    if t.title == "New conversation" and payload.message:
                        t.title = payload.message[:60]
                    s.add(t)
                s.commit()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
