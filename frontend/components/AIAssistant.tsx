'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Send, Sparkles, X, ChevronLeft, ChevronRight, Plus, MessageSquare, Wrench } from 'lucide-react';
import { AIAPI, streamAsk, type AIEvent } from '@/lib/api';
import type { AIMessage, AIThreadSummary, LiveTelemetrySample } from '@/types/module';
import type { LiveReading } from '@/types/test-session';
import { useModuleStore } from '@/hooks/useModuleStore';
import { useAskAIPrefill, type AskAIPrefill } from '@/hooks/useAskAIBus';
import { Markdown } from '@/lib/markdown';

interface Props {
  tabContext: string;
  readings: LiveReading[];
  collapsed: boolean;
  onCollapseChange: (c: boolean) => void;
}

interface PendingMessage {
  role: 'assistant';
  content: string;
  citations: { clause_id: string; title: string }[];
  toolCalls: { name: string; input: Record<string, unknown>; output?: Record<string, unknown> }[];
  streaming: boolean;
}

const QUICK_PROMPTS_BY_TAB: Record<string, string[]> = {
  tc: [
    'Did the last TC run pass Gate 2 (Pmax delta ≤ 5%)?',
    'Show the temperature dwell statistics from the latest cycle.',
  ],
  hf: [
    'Compare humidity-freeze Pmax delta against MQT 12 limits.',
    'Are there any wet leakage anomalies in the last run?',
  ],
  dh: [
    'Has the damp-heat run trended above 5% Pmax loss?',
  ],
  letid: [
    'What is the current LeTID degradation and is the curve recovering?',
    'Recompute Idark from datasheet Isc and Imp.',
  ],
  bdt: [
    'What is the calculated Tj for this run and is it within datasheet limits?',
    'Explain the -2 mV/°C derivation for the bypass diode.',
  ],
  rco: [
    'Summarise the MST 26 reverse-current overload outcome.',
  ],
  gct: [
    'Is ground continuity below 0.1 Ω per MST 13?',
  ],
};

const GENERIC_PROMPTS = [
  'Summarise the active module and the most recent test result.',
  'List the IEC pass criteria for this tab.',
  'Walk me through why this run was rated PASS or FAIL.',
];

export default function AIAssistant({ tabContext, readings, collapsed, onCollapseChange }: Props) {
  const moduleId = useModuleStore((s) => s.selectedId);
  const selectedModule = useModuleStore((s) => (s.selectedId ? s.modules.find((m) => m.module_id === s.selectedId) ?? null : null));
  const activeRunId = useModuleStore((s) => s.activeRunId);

  const [threads, setThreads] = useState<AIThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Helper: derive a live telemetry slice (last 60 s).
  const liveSlice = useMemo<LiveTelemetrySample[]>(() => {
    if (!readings || readings.length === 0) return [];
    const now = Date.now();
    const cutoff = now - 60_000;
    return readings
      .filter((r) => r.timestamp >= cutoff)
      .map((r) => ({
        t: r.timestamp / 1000,
        voltage: r.voltage,
        current: r.current,
        power: r.power,
        temperature: r.temperature ?? null,
      }));
  }, [readings]);

  // Load thread list when the selected module changes.
  useEffect(() => {
    if (!moduleId) {
      setThreads([]);
      setActiveThreadId(null);
      setMessages([]);
      return;
    }
    let cancelled = false;
    AIAPI.listThreads(moduleId)
      .then((list) => {
        if (cancelled) return;
        setThreads(list);
        // Activate the most recent thread for the new module, if any.
        setActiveThreadId(list[0]?.thread_id ?? null);
      })
      .catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [moduleId]);

  // Load messages whenever the active thread changes.
  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    AIAPI.getThread(activeThreadId)
      .then((t) => {
        if (cancelled) return;
        setMessages(t.messages);
      })
      .catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [activeThreadId]);

  // Keep the thread's tab_context fresh when the user switches tabs.
  useEffect(() => {
    if (!activeThreadId || !tabContext) return;
    void AIAPI.patchThread(activeThreadId, { tab_context: tabContext }).catch(() => {});
  }, [activeThreadId, tabContext]);

  // Scroll to bottom on every assistant token.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pending]);

  const ensureThread = useCallback(async () => {
    if (activeThreadId) return activeThreadId;
    if (!moduleId) {
      setError('Select a module before starting a conversation.');
      return null;
    }
    const t = await AIAPI.createThread({
      module_id: moduleId,
      run_id: activeRunId ?? undefined,
      tab_context: tabContext,
      title: 'New conversation',
    });
    setThreads((prev) => [{ ...t }, ...prev]);
    setActiveThreadId(t.thread_id);
    return t.thread_id;
  }, [activeThreadId, moduleId, activeRunId, tabContext]);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || pending) return;
      const threadId = await ensureThread();
      if (!threadId) return;

      const userMsg: AIMessage = {
        id: Date.now(),
        role: 'user',
        content: text.trim(),
        citations: [],
        tool_calls: [],
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setError(null);

      const next: PendingMessage = { role: 'assistant', content: '', citations: [], toolCalls: [], streaming: true };
      setPending(next);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        for await (const ev of streamAsk(
          {
            thread_id: threadId,
            message: text.trim(),
            tab_context: tabContext,
            module_id: moduleId ?? undefined,
            run_id: activeRunId ?? undefined,
            live_telemetry: liveSlice as unknown as Array<Record<string, unknown>>,
          },
          ctrl.signal,
        )) {
          applyEvent(next, ev);
          setPending({ ...next });
        }
      } catch (e) {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      } finally {
        next.streaming = false;
        // Commit pending to messages.
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 1,
            role: 'assistant',
            content: next.content,
            citations: next.citations,
            tool_calls: next.toolCalls,
            created_at: new Date().toISOString(),
          },
        ]);
        setPending(null);
        abortRef.current = null;
      }
    },
    [pending, ensureThread, tabContext, moduleId, activeRunId, liveSlice],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const newThread = useCallback(async () => {
    if (!moduleId) return;
    const t = await AIAPI.createThread({
      module_id: moduleId,
      run_id: activeRunId ?? undefined,
      tab_context: tabContext,
      title: 'New conversation',
    });
    setThreads((prev) => [{ ...t }, ...prev]);
    setActiveThreadId(t.thread_id);
    setMessages([]);
  }, [moduleId, activeRunId, tabContext]);

  // Inline "Ask AI" prefill -> populate the input (and optionally auto-send).
  useAskAIPrefill(
    useCallback(
      (p: AskAIPrefill) => {
        onCollapseChange(false);
        setInput(p.prompt);
        if (p.send) void send(p.prompt);
      },
      [onCollapseChange, send],
    ),
  );

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => onCollapseChange(false)}
        className="w-9 h-full bg-gray-900 border-l border-gray-800 hover:bg-gray-800 flex flex-col items-center justify-center gap-2 text-gray-400 hover:text-white transition-colors"
        title="Open AI assistant"
        data-testid="ai-panel-open"
      >
        <ChevronLeft className="w-4 h-4" />
        <Bot className="w-5 h-5" />
        <span className="rotate-180 text-[10px] tracking-wider [writing-mode:vertical-rl]">AI ASSISTANT</span>
      </button>
    );
  }

  const promptList = QUICK_PROMPTS_BY_TAB[tabContext] ?? GENERIC_PROMPTS;

  return (
    <aside
      data-testid="ai-panel"
      className="w-[380px] flex-shrink-0 border-l border-gray-800 bg-gray-950 flex flex-col h-full"
    >
      <header className="px-3 py-2 border-b border-gray-800 flex items-center gap-2">
        <Bot className="w-4 h-4 text-orange-300" />
        <span className="text-sm font-semibold text-white">AI assistant</span>
        <span className="text-[10px] text-gray-500 ml-1 uppercase tracking-wider">{tabContext || 'global'}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={newThread}
            disabled={!moduleId}
            title="New conversation"
            className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-white disabled:opacity-40"
            data-testid="ai-new-thread"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onCollapseChange(true)}
            title="Collapse"
            className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-white"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Thread switcher */}
      {threads.length > 0 && (
        <div className="px-3 py-2 border-b border-gray-800 flex items-center gap-2 overflow-x-auto">
          <MessageSquare className="w-3 h-3 text-gray-500 flex-shrink-0" />
          <select
            value={activeThreadId ?? ''}
            onChange={(e) => setActiveThreadId(e.target.value || null)}
            className="flex-1 bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-gray-200 min-w-0"
            data-testid="ai-thread-picker"
          >
            {threads.map((t) => (
              <option key={t.thread_id} value={t.thread_id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Module / run pill */}
      <div className="px-3 py-2 border-b border-gray-800 text-[11px] text-gray-400">
        {selectedModule ? (
          <span>
            Module: <span className="text-gray-200">{selectedModule.manufacturer} {selectedModule.model}</span>
            {selectedModule.bypass_diode_part ? <span className="text-gray-500"> · diode <span className="font-mono text-orange-200">{selectedModule.bypass_diode_part}</span></span> : null}
            {activeRunId ? <span className="text-gray-500"> · run <span className="font-mono text-gray-300">{activeRunId.slice(0, 8)}</span></span> : null}
          </span>
        ) : (
          <span className="text-yellow-300">Select a module to enable grounded answers.</span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3" data-testid="ai-messages">
        {messages.length === 0 && !pending && (
          <div className="text-xs text-gray-500 space-y-2">
            <p>Ask anything about the active test, the module on test, or any IEC clause in scope. The assistant has tools to read your test runs, recompute analyses, look up clause text and compare runs.</p>
            <div className="flex flex-wrap gap-1">
              {promptList.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => void send(p)}
                  className="px-2 py-1 rounded text-[11px] bg-gray-900 border border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {pending && <PendingBubble pending={pending} />}
        {error && (
          <div className="text-xs text-red-300 bg-red-900/30 border border-red-700/50 rounded px-2 py-1.5">
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <footer className="px-3 py-2 border-t border-gray-800 flex flex-col gap-1.5">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            placeholder={moduleId ? 'Ask about this test…' : 'Select a module first…'}
            disabled={!moduleId || !!pending}
            data-testid="ai-input"
            className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 disabled:opacity-50 resize-none"
          />
          {pending ? (
            <button
              type="button"
              onClick={stop}
              className="px-3 py-1.5 rounded bg-red-700 hover:bg-red-600 text-white text-xs font-medium"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send(input)}
              disabled={!moduleId || !input.trim()}
              data-testid="ai-send"
              className="px-3 py-1.5 rounded bg-orange-600 hover:bg-orange-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-xs font-medium"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
        <span className="text-[10px] text-gray-500">Enter to send · Shift+Enter for newline · LLM key kept server-side</span>
      </footer>
    </aside>
  );
}

function applyEvent(p: PendingMessage, ev: AIEvent): void {
  switch (ev.type) {
    case 'delta':
      p.content += ev.text;
      return;
    case 'citation':
      if (!p.citations.find((c) => c.clause_id === ev.clause_id)) {
        p.citations.push({ clause_id: ev.clause_id, title: ev.title });
      }
      return;
    case 'tool_call':
      p.toolCalls.push({ name: ev.name, input: ev.input });
      return;
    case 'tool_result': {
      const last = p.toolCalls.find((t) => t.name === ev.name && t.output === undefined);
      if (last) last.output = ev.output;
      return;
    }
    case 'done':
      if (!p.content) p.content = ev.text;
      return;
    case 'error':
      p.content += `\n\n*Error: ${ev.message}*`;
      return;
    default:
      return;
  }
}

function MessageBubble({ message }: { message: AIMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[90%] bg-blue-900/60 border border-blue-800 text-white rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[95%] bg-gray-900 border border-gray-800 text-gray-200 rounded-lg px-3 py-2">
        <div className="text-[10px] text-orange-300 mb-1 inline-flex items-center gap-1">
          <Sparkles className="w-3 h-3" /> Assistant
        </div>
        <Markdown text={message.content} />
        {message.tool_calls.length > 0 && <ToolCalls calls={message.tool_calls} />}
        {message.citations.length > 0 && <Citations citations={message.citations} />}
        {message.tool_calls.some((c) => Array.isArray((c.output as { samples?: unknown[] } | undefined)?.samples)) && (
          <InlineCharts toolCalls={message.tool_calls} />
        )}
      </div>
    </div>
  );
}

function PendingBubble({ pending }: { pending: PendingMessage }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[95%] bg-gray-900 border border-gray-800 text-gray-200 rounded-lg px-3 py-2">
        <div className="text-[10px] text-orange-300 mb-1 inline-flex items-center gap-1">
          <Sparkles className="w-3 h-3 animate-pulse" /> Assistant · streaming
        </div>
        {pending.toolCalls.length > 0 && <ToolCalls calls={pending.toolCalls} />}
        {pending.content ? (
          <Markdown text={pending.content} />
        ) : (
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-300 animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-orange-300 animate-pulse [animation-delay:120ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-orange-300 animate-pulse [animation-delay:240ms]" />
          </div>
        )}
      </div>
    </div>
  );
}

function ToolCalls({ calls }: { calls: PendingMessage['toolCalls'] }) {
  return (
    <details className="mt-2 text-[11px] text-gray-400">
      <summary className="cursor-pointer inline-flex items-center gap-1 text-gray-400 hover:text-gray-200">
        <Wrench className="w-3 h-3" /> {calls.length} tool call{calls.length === 1 ? '' : 's'}
      </summary>
      <ul className="mt-1 space-y-0.5">
        {calls.map((c, i) => (
          <li key={i} className="font-mono text-[10px] text-gray-500">
            <span className="text-orange-300">{c.name}</span>
            (<span className="text-gray-400">{Object.entries(c.input || {}).map(([k, v]) => `${k}=${String(v).slice(0, 24)}`).join(', ')}</span>)
            {c.output && (
              <span className="text-gray-500"> → {Object.keys(c.output).slice(0, 4).join(', ')}{Object.keys(c.output).length > 4 ? '…' : ''}</span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Citations({ citations }: { citations: { clause_id: string; title: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {citations.map((c) => (
        <span
          key={c.clause_id}
          title={c.title}
          className="inline-flex items-center px-1.5 py-0.5 rounded bg-orange-900/40 border border-orange-700/60 text-orange-200 text-[10px] font-mono"
        >
          {c.clause_id}
        </span>
      ))}
    </div>
  );
}

function InlineCharts({ toolCalls }: { toolCalls: PendingMessage['toolCalls'] }) {
  // Render a tiny sparkline for any tool that returned a `samples` series.
  const series = toolCalls
    .map((c) => (Array.isArray((c.output as { samples?: unknown[] } | undefined)?.samples) ? (c.output as { samples: Array<Record<string, number>> }).samples : null))
    .filter((s): s is Array<Record<string, number>> => Boolean(s));
  if (series.length === 0) return null;
  return (
    <div className="mt-2 space-y-1">
      {series.map((s, i) => (
        <Sparkline key={i} series={s} />
      ))}
    </div>
  );
}

function Sparkline({ series }: { series: Array<Record<string, number | null>> }) {
  const values = series.map((p) => (typeof p.power === 'number' ? p.power : typeof p.voltage === 'number' ? p.voltage : 0));
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const w = 200;
  const h = 32;
  const range = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1 || 1)) * w},${h - ((v - min) / range) * h}`)
    .join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="bg-black/40 rounded">
      <polyline points={pts} fill="none" stroke="#fb923c" strokeWidth="1.5" />
    </svg>
  );
}
