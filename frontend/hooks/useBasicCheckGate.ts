'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Polls ``GET /api/basic-check/status?module_id=…`` and exposes
 * ``{ passed, ageS, expiresInS, polling, error, refetch }``. The TC tab
 * uses this to gate Start. Pass interval is 10 s per operator UX spec —
 * the server re-evaluates on every PSU command anyway.
 */

export interface BasicCheckGateState {
  passed: boolean;
  ageS: number;
  expiresInS: number | null;
  polling: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

interface StatusBody {
  module_id: string;
  passed: boolean;
  age_s: number;
  ttl_s: number;
  expires_in_s: number | null;
  passed_at: string | null;
  run_id: string | null;
}

const BACKEND = (process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000').replace(/\/+$/, '');

export function useBasicCheckGate(moduleId: string | null | undefined, pollMs: number = 10_000): BasicCheckGateState {
  const [state, setState] = useState<Omit<BasicCheckGateState, 'refetch'>>({
    passed: false, ageS: -1, expiresInS: null, polling: true, error: null,
  });

  const probe = useCallback(async (): Promise<void> => {
    if (!moduleId) {
      setState({ passed: false, ageS: -1, expiresInS: null, polling: false, error: null });
      return;
    }
    try {
      const url = `${BACKEND}/api/basic-check/status?module_id=${encodeURIComponent(moduleId)}`;
      const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!r.ok) {
        setState(s => ({ ...s, polling: false, error: `HTTP ${r.status}` }));
        return;
      }
      const j = (await r.json()) as StatusBody;
      setState({
        passed: !!j.passed,
        ageS: typeof j.age_s === 'number' ? j.age_s : -1,
        expiresInS: typeof j.expires_in_s === 'number' ? j.expires_in_s : null,
        polling: false,
        error: null,
      });
    } catch (e) {
      setState(s => ({ ...s, polling: false, error: e instanceof Error ? e.message : String(e) }));
    }
  }, [moduleId]);

  useEffect(() => {
    let cancelled = false;
    void probe();
    const t = window.setInterval(() => { if (!cancelled) void probe(); }, pollMs);
    return () => { cancelled = true; window.clearInterval(t); };
  }, [probe, pollMs]);

  return { ...state, refetch: probe };
}
