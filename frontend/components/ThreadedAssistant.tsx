'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, Loader2, Send, Trash2, Wrench, X } from 'lucide-react';
import { useAssistantThread, type ToolCall, type ToolResult } from '@/hooks/useAssistantThread';

interface ThreadedAssistantProps {
  moduleId: string;
  testRunId?: number;
  /** Optional UI context (current tab/sub-tab) forwarded to the backend. */
  context?: Record<string, unknown>;
  /** Compact mode for the side-rail; defaults to false (full-page). */
  compact?: boolean;
  /** Optional close handler — when provided, an X button is rendered. */
  onClose?: () => void;
  /** Module-aware quick prompts displayed above the input. */
  quickPrompts?: string[];
}

const DEFAULT_PROMPTS = [
  'Summarise this module\'s history',
  'Recompute ΔPmax for the current run',
  'Should we PASS or FAIL this run?',
  'Show the last 50 telemetry samples',
];

export default function ThreadedAssistant({
  moduleId, testRunId, context, compact = false, onClose,
  quickPrompts = DEFAULT_PROMPTS,
}: ThreadedAssistantProps) {
  const { messages, streaming, loading, error, send, clear, cancel } =
    useAssistantThread(moduleId);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streaming]);

  const submit = (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || !moduleId) return;
    setInput('');
    void send(msg, { testRunId, context });
  };

  if (!moduleId) {
    return (
      <div className={`${compact ? 'p-3' : 'p-8'} text-center text-xs text-gray-500`}>
        <Bot className="w-8 h-8 mx-auto mb-2 opacity-60" />
        Enter a Module ID in the header to start a threaded conversation.
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${compact ? 'gap-2 p-3' : 'gap-4 p-4'}`}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <Bot className="w-4 h-4 text-blue-400" />
        <span className={`font-bold text-white ${compact ? 'text-xs' : 'text-base'}`}>
          AI Assistant
        </span>
        <span className="text-[10px] text-gray-400 font-mono truncate max-w-[16ch]" title={`Module ${moduleId}`}>
          · {moduleId}
        </span>
        {testRunId != null && (
          <span className="text-[10px] text-cyan-400 font-mono">· TR-{testRunId}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => void clear()}
            disabled={messages.length === 0 || loading}
            title="Clear thread"
            className="text-gray-500 hover:text-red-300 disabled:opacity-30 p-1 rounded"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="text-gray-500 hover:text-white p-1 rounded"
              title="Hide assistant"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Quick prompts */}
      {!compact && (
        <div className="flex flex-wrap gap-1.5">
          {quickPrompts.map(p => (
            <button
              key={p}
              type="button"
              onClick={() => submit(p)}
              disabled={loading}
              className="px-2 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 hover:text-white text-[11px] rounded border border-gray-700"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-gray-950 border border-gray-800 rounded-lg p-3 space-y-3 min-h-0">
        {messages.length === 0 && !streaming && (
          <div className="text-center text-gray-500 text-xs py-6">
            One thread spans this module's Setup, Live Monitor, Data, Analysis,
            and Report tabs. Ask anything — TR ids, ΔPmax, telemetry, verdict.
          </div>
        )}
        {messages.map((m, i) => (
          <MessageBubble key={`${m.ts}-${i}`} role={m.role} text={m.content}
            toolCalls={m.tool_calls ?? []} toolResults={m.tool_results ?? []} />
        ))}
        {streaming && (
          <MessageBubble
            role="assistant"
            text={streaming.text}
            toolCalls={streaming.toolCalls}
            toolResults={streaming.toolResults}
            streaming
          />
        )}
        {loading && !streaming?.text && (
          <div className="flex justify-start text-xs text-gray-500">
            <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> thinking…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="text-[11px] text-red-300 bg-red-900/30 border border-red-800/60 rounded px-2 py-1">
          {error}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2 items-end">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={compact ? 2 : 3}
          placeholder={`Message for module ${moduleId}…`}
          className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
        />
        {loading ? (
          <button
            type="button"
            onClick={cancel}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs font-semibold"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => submit()}
            disabled={!input.trim()}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-800 disabled:text-gray-500 text-white rounded text-xs font-semibold"
          >
            <Send className="w-3 h-3" /> Send
          </button>
        )}
      </div>
    </div>
  );
}

interface BubbleProps {
  role: 'user' | 'assistant' | 'system';
  text: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  streaming?: boolean;
}

function MessageBubble({ role, text, toolCalls, toolResults, streaming }: BubbleProps) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[88%] rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
          isUser ? 'bg-blue-800/80 text-white' : 'bg-gray-800/90 text-gray-100'
        } ${streaming ? 'border border-blue-700/50' : ''}`}
      >
        {toolCalls.length > 0 && (
          <div className="mb-2 space-y-1">
            {toolCalls.map((tc, idx) => {
              const tr = toolResults[idx];
              return (
                <details key={`${tc.name}-${idx}`} className="bg-black/30 rounded border border-gray-700 text-[10px]">
                  <summary className="cursor-pointer px-2 py-1 flex items-center gap-1 text-gray-300">
                    <Wrench className="w-3 h-3 text-amber-400" />
                    <span className="font-mono">{tc.name}</span>
                    <span className="text-gray-500 truncate">({summariseArgs(tc.args)})</span>
                    {tr && <span className="ml-auto text-green-400">✓</span>}
                  </summary>
                  <pre className="px-2 py-1 overflow-x-auto text-gray-400 font-mono">
{JSON.stringify(tr?.result ?? {}, null, 2).slice(0, 800)}
                  </pre>
                </details>
              );
            })}
          </div>
        )}
        {text || (streaming ? '…' : '')}
      </div>
    </div>
  );
}

function summariseArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    if (v == null) continue;
    parts.push(`${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
    if (parts.join(', ').length > 50) break;
  }
  return parts.join(', ');
}
