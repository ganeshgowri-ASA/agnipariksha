// Lightweight fetch wrapper for the FastAPI backend.
//
// All routes are resolved against NEXT_PUBLIC_API_URL so the same code runs
// in dev, prod, and the Tauri shell. Errors are normalised into `ApiError`
// so callers can `try/catch` without inspecting Response objects.

export const API_BASE =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL) ||
  'http://localhost:8000';

export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(status: number, message: string, payload: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export interface ApiRequestInit extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
}

function buildUrl(path: string, query?: ApiRequestInit['query']): string {
  const base = API_BASE.replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const url = `${base}${suffix}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    params.append(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function apiFetch<T = unknown>(
  path: string,
  init: ApiRequestInit = {}
): Promise<T> {
  const { body, query, timeoutMs = 15_000, headers, ...rest } = init;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const isJsonBody = body !== undefined && !(body instanceof FormData);
  const finalHeaders: HeadersInit = {
    Accept: 'application/json',
    ...(isJsonBody ? { 'Content-Type': 'application/json' } : {}),
    ...(headers ?? {}),
  };

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      ...rest,
      headers: finalHeaders,
      body: isJsonBody ? JSON.stringify(body) : (body as BodyInit | undefined),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(0, `Request timed out after ${timeoutMs}ms`);
    }
    throw new ApiError(0, (err as Error).message ?? 'Network error');
  }
  clearTimeout(timer);

  const contentType = response.headers.get('content-type') ?? '';
  const payload: unknown = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  if (!response.ok) {
    const message =
      (payload && typeof payload === 'object' && 'detail' in payload
        ? String((payload as { detail: unknown }).detail)
        : null) ?? response.statusText ?? `HTTP ${response.status}`;
    throw new ApiError(response.status, message, payload);
  }

  return payload as T;
}

export const api = {
  get:  <T = unknown>(path: string, init?: ApiRequestInit) => apiFetch<T>(path, { ...init, method: 'GET' }),
  post: <T = unknown>(path: string, body?: unknown, init?: ApiRequestInit) => apiFetch<T>(path, { ...init, method: 'POST', body }),
  put:  <T = unknown>(path: string, body?: unknown, init?: ApiRequestInit) => apiFetch<T>(path, { ...init, method: 'PUT', body }),
  del:  <T = unknown>(path: string, init?: ApiRequestInit) => apiFetch<T>(path, { ...init, method: 'DELETE' }),
};

// Convenience for the safety-critical E-STOP path. Kept here so every caller
// hits the same endpoint and timeout.
export async function emergencyStop(): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await api.post<{ ok: boolean; message?: string }>('/api/device/estop', {}, { timeoutMs: 5_000 });
    return res ?? { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof ApiError ? err.message : 'E-STOP request failed',
    };
  }
}
