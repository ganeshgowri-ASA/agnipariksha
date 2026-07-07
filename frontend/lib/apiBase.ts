// Single source of truth for the backend HTTP base URL.
//
// Default is SAME-ORIGIN ('') so the browser calls relative paths like
// `/api/opcua/psu`, which next.config rewrites proxy to the backend on the
// server side. That keeps every browser→backend call same-origin, so a
// single tunnel of the frontend shares the whole working app and there is no
// cross-origin/localhost coupling to break. Set NEXT_PUBLIC_API_BASE to an
// absolute URL only if you deliberately want the browser to hit the backend
// directly (bypassing the proxy).
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? '').replace(/\/+$/, '');

/** Human-readable message for a failed backend fetch. */
export function fetchErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (raw === 'Failed to fetch' || raw.includes('NetworkError')) {
    const where = API_BASE || 'the backend';
    return `Backend not reachable (${where}) — is the backend window running? Retrying…`;
  }
  return raw;
}
