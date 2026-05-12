/**
 * Frontend client for the FastAPI backend (modules / runs / AI threads).
 *
 * `NEXT_PUBLIC_BACKEND_HTTP_URL` lets the desktop / dev build point at a
 * non-default backend. Falls back to localhost:8000 — matches the rest
 * of the codebase (see app/api/health/route.ts).
 */
import type {
  AIThread,
  AIThreadSummary,
  ModuleInput,
  PVModule,
  TestRunSummary,
} from '@/types/module';

export const BACKEND_BASE =
  process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000';

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    cache: 'no-store',
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} — ${text}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

// ----- Modules ------------------------------------------------------------
export const ModulesAPI = {
  list: () => json<PVModule[]>('/api/modules'),
  create: (m: ModuleInput) => json<PVModule>('/api/modules', { method: 'POST', body: JSON.stringify(m) }),
  get: (id: string) => json<PVModule>(`/api/modules/${id}`),
  remove: (id: string) => json<void>(`/api/modules/${id}`, { method: 'DELETE' }),
};

// ----- Runs ---------------------------------------------------------------
export const RunsAPI = {
  list: (params: { module_id?: string; test_type?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.module_id) qs.set('module_id', params.module_id);
    if (params.test_type) qs.set('test_type', params.test_type);
    const s = qs.toString();
    return json<TestRunSummary[]>(`/api/runs${s ? '?' + s : ''}`);
  },
  create: (r: {
    module_id: string;
    test_type: string;
    iec_clause?: string;
    params?: Record<string, unknown>;
    operator?: string;
  }) => json<TestRunSummary>('/api/runs', { method: 'POST', body: JSON.stringify(r) }),
  get: (id: string) => json<TestRunSummary>(`/api/runs/${id}`),
  appendTelemetry: (id: string, samples: Array<Record<string, unknown>>) =>
    json<TestRunSummary>(`/api/runs/${id}/telemetry`, {
      method: 'POST',
      body: JSON.stringify({ samples }),
    }),
  patch: (id: string, body: Record<string, unknown>) =>
    json<TestRunSummary>(`/api/runs/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
};

// ----- AI threads ---------------------------------------------------------
export const AIAPI = {
  listThreads: (module_id?: string) => {
    const qs = module_id ? `?module_id=${encodeURIComponent(module_id)}` : '';
    return json<AIThreadSummary[]>(`/api/ai/threads${qs}`);
  },
  createThread: (body: { module_id?: string; run_id?: string; tab_context?: string; title?: string }) =>
    json<AIThread>('/api/ai/threads', { method: 'POST', body: JSON.stringify(body) }),
  getThread: (id: string) => json<AIThread>(`/api/ai/threads/${id}`),
  patchThread: (id: string, body: Record<string, unknown>) =>
    json<AIThread>(`/api/ai/threads/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteThread: (id: string) => json<void>(`/api/ai/threads/${id}`, { method: 'DELETE' }),
  askURL: () => `${BACKEND_BASE}/api/ai/ask`,
};

// ----- SSE parser ---------------------------------------------------------
export type AIEvent =
  | { type: 'context'; summary: string }
  | { type: 'tool_call'; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; name: string; output: Record<string, unknown> }
  | { type: 'delta'; text: string }
  | { type: 'citation'; clause_id: string; title: string }
  | { type: 'done'; text: string; citations: string[] }
  | { type: 'error'; message: string };

/**
 * Stream the agent's events. Yields one event per SSE message until the
 * stream closes. The caller passes an AbortSignal to cancel.
 */
export async function* streamAsk(
  body: {
    thread_id: string;
    message: string;
    tab_context?: string;
    module_id?: string;
    run_id?: string;
    live_telemetry?: Array<Record<string, unknown>>;
  },
  signal?: AbortSignal,
): AsyncGenerator<AIEvent> {
  const res = await fetch(AIAPI.askURL(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`SSE failed: ${res.status} ${res.statusText}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLine = raw.split('\n').find(l => l.startsWith('data: '));
      if (!dataLine) continue;
      try {
        yield JSON.parse(dataLine.slice(6)) as AIEvent;
      } catch {
        /* ignore parse errors on partial frames */
      }
    }
  }
}
