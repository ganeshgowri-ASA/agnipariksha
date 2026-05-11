// Thin REST wrappers for the test-control + report endpoints exposed by the
// FastAPI backend. All calls are best-effort: when the backend is unreachable
// the helpers fall back to a local-only path so the UI remains usable in
// demo / disconnected mode.

import type { ModuleSpec, TestId } from './testSchemas';

const API_BASE =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL) ||
  'http://localhost:8000';

export interface StartTestPayload {
  testId: TestId;
  module: ModuleSpec;
  params: Record<string, number>;
  operator?: string;
}

export interface StartTestResponse {
  sessionId: string;
  startedAt: number;
}

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

const TIMEOUT_MS = 4000;

async function request<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network error';
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

export async function startTest(
  payload: StartTestPayload,
): Promise<ApiResult<StartTestResponse>> {
  return request<StartTestResponse>(`/api/tests/${payload.testId}/start`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function stopTest(
  testId: TestId,
  sessionId: string,
): Promise<ApiResult<{ sessionId: string; stoppedAt: number }>> {
  return request(`/api/tests/${testId}/stop`, {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
}

export async function pauseTest(
  testId: TestId,
  sessionId: string,
): Promise<ApiResult<{ sessionId: string }>> {
  return request(`/api/tests/${testId}/pause`, {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
}

export type ReportFormat = 'word' | 'pdf';

// Returns true when the backend served the report (and download was triggered).
// Caller is expected to fall back to client-side generation if this returns false.
export async function downloadReport(
  sessionId: string,
  format: ReportFormat,
  fileName: string,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS * 4);
  try {
    const res = await fetch(`${API_BASE}/api/reports/${sessionId}/${format}`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    triggerBlobDownload(blob, fileName);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
