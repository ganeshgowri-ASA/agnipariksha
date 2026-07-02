// Single source of truth for the backend HTTP base URL.
//
// History: pages grew three different env vars for the same thing
// (NEXT_PUBLIC_BACKEND_HTTP_URL, NEXT_PUBLIC_API_BASE, NEXT_PUBLIC_API_URL),
// so a host override set via one var silently missed the pages reading the
// others. All client code imports API_BASE from here; the legacy vars are
// still honoured, in that order, so existing deployments keep working.
export const API_BASE = (
  process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ??
  process.env.NEXT_PUBLIC_API_BASE ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:8000'
).replace(/\/+$/, '');

/** Human-readable message for a failed backend fetch. */
export function fetchErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (raw === 'Failed to fetch' || raw.includes('NetworkError')) {
    return `Backend not reachable at ${API_BASE} — is the backend window running? Retrying…`;
  }
  return raw;
}
