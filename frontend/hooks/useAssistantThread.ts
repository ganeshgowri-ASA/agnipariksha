'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ToolCall { name: string; args: Record<string, unknown> }
export interface ToolResult { name: string; result: Record<string, unknown> }

export interface ThreadMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: number;
  tool_calls?: ToolCall[];
  tool_results?: ToolResult[];
}

interface ThreadOut {
  module_id: string;
  thread_id: number;
  created_at: string;
  updated_at: string;
  messages: ThreadMessage[];
}

interface SendOptions {
  testRunId?: number;
  context?: Record<string, unknown>;
}

interface StreamState {
  text: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  threadId: number | null;
  demo: boolean;
}

const EMPTY_STREAM: StreamState = {
  text: '', toolCalls: [], toolResults: [], threadId: null, demo: false,
};

/**
 * Hook that owns the per-module AI thread.
 *
 * Server is the source of truth — we fetch the thread on mount/key-change
 * and on every successful round-trip. While a response is streaming, the
 * intermediate state lives in ``streaming`` so the UI can render token-by-
 * token without persisting half-finished messages.
 */
export function useAssistantThread(moduleId: string) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [streaming, setStreaming] = useState<StreamState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reload = useCallback(async (mid: string) => {
    if (!mid) {
      setMessages([]);
      return;
    }
    try {
      const r = await fetch(`/api/assistant/threads/${encodeURIComponent(mid)}`, {
        cache: 'no-store',
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json()) as ThreadOut;
      setMessages(body.messages || []);
    } catch (e) {
      setError(`Failed to load thread: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    setStreaming(null);
    setError(null);
    void reload(moduleId);
  }, [moduleId, reload]);

  const clear = useCallback(async () => {
    if (!moduleId) return;
    abortRef.current?.abort();
    await fetch(`/api/assistant/threads/${encodeURIComponent(moduleId)}`, {
      method: 'DELETE',
    });
    setMessages([]);
    setStreaming(null);
  }, [moduleId]);

  const send = useCallback(
    async (message: string, opts: SendOptions = {}) => {
      const trimmed = message.trim();
      if (!trimmed || !moduleId || loading) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      setError(null);
      setStreaming({ ...EMPTY_STREAM });
      const pendingUser: ThreadMessage = { role: 'user', content: trimmed, ts: Date.now() / 1000 };
      setMessages(prev => [...prev, pendingUser]);

      try {
        const res = await fetch(
          `/api/assistant/threads/${encodeURIComponent(moduleId)}/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: trimmed,
              test_run_id: opts.testRunId,
              context: opts.context,
            }),
            signal: ctrl.signal,
          },
        );
        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }
        await consumeSse(res.body, (evt, data) => {
          setStreaming(prev => {
            const cur = prev ?? { ...EMPTY_STREAM };
            switch (evt) {
              case 'meta':
                return { ...cur, threadId: data.thread_id ?? cur.threadId, demo: !!data.demo };
              case 'tool_call':
                return { ...cur, toolCalls: [...cur.toolCalls, data as ToolCall] };
              case 'tool_result':
                return { ...cur, toolResults: [...cur.toolResults, data as ToolResult] };
              case 'token':
                return { ...cur, text: cur.text + (data.text ?? '') };
              default:
                return cur;
            }
          });
        });
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setError((e as Error).message);
      } finally {
        setLoading(false);
        // Refresh from the canonical persisted thread; this also discards
        // the pending user shim above in favour of the server's record.
        await reload(moduleId);
        setStreaming(null);
        abortRef.current = null;
      }
    },
    [moduleId, loading, reload],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, streaming, loading, error, send, clear, cancel, reload: () => reload(moduleId) };
}

/**
 * Walk an SSE response body, dispatching one (event, data) pair at a time.
 *
 * The spec allows arbitrary chunk boundaries, so we accumulate until we see
 * a blank-line separator and then parse the assembled event. Multi-line
 * ``data:`` fields are re-joined with newlines per the spec.
 */
async function consumeSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: any) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep = buf.indexOf('\n\n');
    while (sep !== -1) {
      const raw = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      sep = buf.indexOf('\n\n');
      if (!raw.trim()) continue;
      let evt = 'message';
      const data: string[] = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) evt = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      const text = data.join('\n');
      let parsed: any = text;
      try { parsed = JSON.parse(text); } catch { /* keep raw */ }
      onEvent(evt, parsed);
    }
  }
}
