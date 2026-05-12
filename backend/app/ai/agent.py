"""LangGraph-style agent loop driven by Anthropic tool-use.

The agent receives a thread of prior messages and a context payload
(current tab, module, active run, last 60 s telemetry summary, relevant
IEC clause text). It calls Claude's Messages API in a loop, executing
any ``tool_use`` content blocks via ``tools.dispatch`` and feeding the
``tool_result`` back. When Claude emits ``stop_reason="end_turn"`` the
final text is yielded; when streaming, deltas yield as they arrive.

Anthropic key is read from the environment — never hardcoded.
"""
from __future__ import annotations

import json
import logging
import os
import statistics
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Iterable

from . import tools as agent_tools

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are the Agnipariksha test-engineering assistant. You help PV reliability
engineers interpret tests run on an ITECH PV6000 across seven IEC procedures:
Thermal Cycling (MQT 11), Humidity Freeze (MQT 12), Damp Heat (MQT 13),
Bypass Diode Thermal (MQT 18 / IEC 62979), LeTID (MQT 21 / IEC TS 63342),
Reverse Current Overload (MST 26) and Ground Continuity (MST 13).

Rules:
- Always ground numeric claims in the tools. If you assert a Pmax delta,
  Tj estimate or pass/fail, you must have called recompute_analysis or
  suggest_pass_fail in this turn (or the same turn).
- Cite the IEC clause id (e.g. "MQT 18", "IEC TS 63342") whenever you quote
  a threshold.
- Be concise. Engineering prose, not marketing.
- When data is missing, say so plainly and recommend which tool/measurement
  would resolve it.
- For bypass-diode questions, the Tj derivation uses the diode's Vf shift
  with a default -2 mV/°C coefficient unless the datasheet says otherwise.
  Always reference the bypass_diode_part from the module record when
  discussing the diode.
"""


@dataclass
class AgentContext:
    tab: str = ""
    module: dict[str, Any] | None = None
    run: dict[str, Any] | None = None
    telemetry_summary: dict[str, Any] | None = None
    clause: dict[str, Any] | None = None
    extras: dict[str, Any] = field(default_factory=dict)

    def render(self) -> str:
        parts: list[str] = []
        if self.tab:
            parts.append(f"Active tab: {self.tab}")
        if self.module:
            m = self.module
            parts.append(
                "Selected module: "
                f"{m.get('manufacturer','?')} {m.get('model','?')} "
                f"(id={m.get('module_id')}) — "
                f"Pmax_STC={m.get('pmax_stc')} W, Voc={m.get('voc')} V, "
                f"Isc={m.get('isc')} A, Vmpp={m.get('vmpp')} V, "
                f"Impp={m.get('impp')} A, bypass_diode={m.get('bypass_diode_part') or 'n/a'}, "
                f"technology={m.get('technology')}."
            )
        if self.run:
            r = self.run
            parts.append(
                f"Active run: id={r.get('run_id')} type={r.get('test_type')} "
                f"status={r.get('status')} pass_fail={r.get('pass_fail')}."
            )
        if self.telemetry_summary:
            parts.append("Last 60 s telemetry: " + json.dumps(self.telemetry_summary))
        if self.clause:
            c = self.clause
            parts.append(
                f"IEC clause in scope ({c.get('clause_id')} / {c.get('standard')}): "
                f"{c.get('summary')}\nPass criterion: {c.get('pass_fail')}"
            )
        return "\n".join(parts) if parts else "(no extra context)"


def summarise_telemetry(samples: Iterable[dict[str, Any]]) -> dict[str, Any]:
    samples = list(samples)
    if not samples:
        return {"count": 0}
    out: dict[str, Any] = {"count": len(samples)}
    for key in ("voltage", "current", "power", "temperature"):
        vals = [s[key] for s in samples if s.get(key) is not None]
        if vals:
            out[f"{key}_min"] = min(vals)
            out[f"{key}_max"] = max(vals)
            out[f"{key}_mean"] = statistics.fmean(vals)
    out["t_first"] = samples[0].get("t")
    out["t_last"] = samples[-1].get("t")
    return out


# ---------------------------------------------------------------------------
# Anthropic client wrapper — kept thin so tests can stub it out.
# ---------------------------------------------------------------------------
def _get_client():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return None
    try:
        from anthropic import Anthropic  # type: ignore
    except ImportError:
        return None
    return Anthropic(api_key=api_key)


MODEL_DEFAULT = os.environ.get("AGNI_LLM_MODEL", "claude-sonnet-4-6")
MAX_TOOL_ITERATIONS = 6


def _claude_messages(history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert stored AIMessage rows into Anthropic message blocks."""
    out: list[dict[str, Any]] = []
    for m in history:
        role = m["role"]
        content = m["content"]
        if role == "user":
            out.append({"role": "user", "content": content})
        elif role == "assistant":
            out.append({"role": "assistant", "content": content})
    return out


async def run_agent_stream(
    *,
    history: list[dict[str, Any]],
    user_text: str,
    context: AgentContext,
    model: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Yield streaming events as dicts: {type, ...}.

    Event shapes:
      {"type": "context", "summary": str}
      {"type": "tool_call", "name": str, "input": dict}
      {"type": "tool_result", "name": str, "output": dict}
      {"type": "delta", "text": str}
      {"type": "citation", "clause_id": str, "title": str}
      {"type": "done", "text": str}
      {"type": "error", "message": str}
    """
    client = _get_client()
    base_messages = _claude_messages(history) + [{"role": "user", "content": user_text}]
    system = SYSTEM_PROMPT + "\n\nContext for this turn:\n" + context.render()

    yield {"type": "context", "summary": context.render()}

    if client is None:
        # Offline / no-key fallback — deterministic answer routed via tools so
        # the assistant is still demonstrably grounded in test data.
        async for ev in _fallback_stream(user_text, context):
            yield ev
        return

    cited: set[str] = set()
    if context.clause:
        cid = context.clause.get("clause_id")
        if cid:
            cited.add(cid)
            yield {"type": "citation", "clause_id": cid, "title": context.clause.get("title", "")}

    messages = list(base_messages)
    final_text = ""
    try:
        for _ in range(MAX_TOOL_ITERATIONS):
            resp = client.messages.create(
                model=model or MODEL_DEFAULT,
                max_tokens=2048,
                system=system,
                tools=agent_tools.TOOL_SCHEMAS,
                messages=messages,
            )
            assistant_blocks: list[dict[str, Any]] = []
            text_chunks: list[str] = []
            tool_uses: list[tuple[str, str, dict[str, Any]]] = []  # (id, name, input)
            for block in resp.content:
                btype = getattr(block, "type", None)
                if btype == "text":
                    text_chunks.append(block.text)
                    assistant_blocks.append({"type": "text", "text": block.text})
                elif btype == "tool_use":
                    tool_uses.append((block.id, block.name, dict(block.input)))
                    assistant_blocks.append(
                        {"type": "tool_use", "id": block.id, "name": block.name, "input": dict(block.input)}
                    )

            if text_chunks:
                joined = "".join(text_chunks)
                final_text = joined
                # Stream the deltas as one chunk (Anthropic non-stream call —
                # the SSE wrapper will break it up before sending).
                yield {"type": "delta", "text": joined}

            if not tool_uses or resp.stop_reason == "end_turn":
                break

            messages.append({"role": "assistant", "content": assistant_blocks})
            tool_results: list[dict[str, Any]] = []
            for tu_id, name, args in tool_uses:
                yield {"type": "tool_call", "name": name, "input": args}
                output = agent_tools.dispatch(name, args)
                yield {"type": "tool_result", "name": name, "output": output}
                if name == "get_iec_clause" and isinstance(output, dict) and "clause_id" in output:
                    cid = output["clause_id"]
                    if cid not in cited:
                        cited.add(cid)
                        yield {"type": "citation", "clause_id": cid, "title": output.get("title", "")}
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tu_id,
                        "content": json.dumps(output)[:8000],
                    }
                )
            messages.append({"role": "user", "content": tool_results})
    except Exception as exc:  # pragma: no cover - network failure path
        log.exception("agent loop failed")
        yield {"type": "error", "message": str(exc)}
        return

    yield {"type": "done", "text": final_text, "citations": sorted(cited)}


async def _fallback_stream(user_text: str, context: AgentContext) -> AsyncIterator[dict[str, Any]]:
    """Deterministic, tool-grounded answer when no LLM key is configured.

    Still hits the same tool surface so QA on the agent's reasoning loop
    works in CI without an API key. Specifically: if a run is in scope,
    it runs recompute_analysis + suggest_pass_fail and renders the
    summary, citing the active clause.
    """
    lower = user_text.lower()
    sections: list[str] = ["**Offline assistant (no ANTHROPIC_API_KEY set)** — answering from tool output only.\n"]
    cited: set[str] = set()

    if context.run and context.run.get("run_id"):
        rid = context.run["run_id"]
        yield {"type": "tool_call", "name": "recompute_analysis", "input": {"run_id": rid}}
        analysis = agent_tools.dispatch("recompute_analysis", {"run_id": rid})
        yield {"type": "tool_result", "name": "recompute_analysis", "output": analysis}

        yield {"type": "tool_call", "name": "suggest_pass_fail", "input": {"run_id": rid}}
        verdict = agent_tools.dispatch("suggest_pass_fail", {"run_id": rid})
        yield {"type": "tool_result", "name": "suggest_pass_fail", "output": verdict}

        sections.append(f"### Run `{rid}` — {context.run.get('test_type', '?').upper()}")
        if isinstance(analysis, dict):
            if "pmax_delta_pct" in analysis:
                sections.append(f"- Pmax delta: **{analysis['pmax_delta_pct']:.2f}%** ({analysis.get('p_first_w', 0):.2f} W → {analysis.get('p_last_w', 0):.2f} W)")
            if "tj_estimated_c" in analysis:
                sections.append(
                    f"- Estimated bypass-diode Tj: **{analysis['tj_estimated_c']:.1f} °C** "
                    f"(slope {analysis.get('vf_slope_mV_per_C', -2.0)} mV/°C; limit {analysis.get('tj_limit_c', 128)} °C)."
                )
                part = analysis.get("bypass_diode_part") or (context.module or {}).get("bypass_diode_part")
                if part:
                    sections.append(f"- Diode part on record: `{part}`.")
            if "temp_max_c" in analysis:
                sections.append(f"- Temperature peak: {analysis['temp_max_c']:.1f} °C")
        if isinstance(verdict, dict):
            sections.append(f"- Suggested verdict: **{verdict.get('verdict')}**")
            for reason in verdict.get("reasons", []):
                sections.append(f"  - {reason}")
            if verdict.get("clause"):
                cited.add(verdict["clause"])

    if context.clause:
        cid = context.clause.get("clause_id")
        if cid:
            cited.add(cid)
        sections.append(
            f"\n### IEC reference — {context.clause.get('clause_id')} ({context.clause.get('standard')})\n"
            f"{context.clause.get('summary', '')}\n"
            f"**Pass criterion:** {context.clause.get('pass_fail', '')}"
        )

    if "tj" in lower and not any("Tj" in s for s in sections):
        sections.append(
            "Tj is computed from the bypass-diode forward-voltage shift: "
            "`Tj = Tj_ref + (Vf_ref - Vf_now) / |dVf/dTj|` with the silicon "
            "default coefficient of **-2 mV/°C**. The Vf is sampled while "
            "1.0–1.25 × Isc is forced through the diode at +75 °C ambient (MQT 18)."
        )
        cited.add("MQT18")

    text = "\n".join(sections)
    for clause_id in sorted(cited):
        yield {"type": "citation", "clause_id": clause_id, "title": ""}
    yield {"type": "delta", "text": text}
    yield {"type": "done", "text": text, "citations": sorted(cited)}
