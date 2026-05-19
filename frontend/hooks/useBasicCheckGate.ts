'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Tracks the backend Basic Check pass for a given Module ID.
 *
 * Wraps GET /api/basic-check/status and POST /api/basic-check/pass. The
 * dashboard polls every {pollMs} so the gate auto-expires after the 60 min
 * TTL without requiring a route change.
 */

export interface BasicCheckStatus {
  module_id: string;
  passed: boolean;
  age_s: number;
  ttl_s: number;
  expires_in_s: number | null;
  passed_at: string | null;
  run_id: string | null;
}

const BACKEND = (process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? '').replace(/\/+$/, '');

export function useBasicCheckGate(moduleId: string | null, pollMs: number = 10_000) {
  const [status, setStatus] = useState<BasicCheckStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback(async (): Promise<BasicCheckStatus | null> => {
    if (!moduleId) {
      setLoading(false);
      return null;
    }
    try {
      const url = `${BACKEND}/api/basic-check/status?module_id=${encodeURIComponent(moduleId)}`;
      const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
      if (!r.ok) {
        setStatus(prev => prev ?? null);
        return null;
      }
      const j = (await r.json()) as BasicCheckStatus;
      setStatus(j);
      return j;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, [moduleId]);

  const recordPass = useCallback(async (runId?: string): Promise<BasicCheckStatus | null> => {
    if (!moduleId) return null;
    try {
      const r = await fetch(`${BACKEND}/api/basic-check/pass`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module_id: moduleId, run_id: runId ?? null }),
        signal: AbortSignal.timeout(3000),
      });
      if (!r.ok) return null;
      const j = (await r.json()) as BasicCheckStatus;
      setStatus(j);
      return j;
    } catch {
      return null;
    }
  }, [moduleId]);

  useEffect(() => {
    void refresh();
    if (!moduleId) return;
    const t = window.setInterval(() => { void refresh(); }, pollMs);
    return () => { window.clearInterval(t); };
  }, [refresh, moduleId, pollMs]);

  return { status, loading, refresh, recordPass };
}
