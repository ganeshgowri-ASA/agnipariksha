'use client';

import { useEffect, useState } from 'react';

export interface HealthSnapshot {
  status: 'ok' | 'degraded' | 'down' | 'unknown';
  scpi_reachable: boolean | null;
  demo: boolean | null;
  version: string | null;
  uptime_s: number | null;
  raw?: unknown;
}

const INITIAL: HealthSnapshot = {
  status: 'unknown',
  scpi_reachable: null,
  demo: null,
  version: null,
  uptime_s: null,
};

export function useHealth(pollMs: number = 5_000): HealthSnapshot {
  const [snap, setSnap] = useState<HealthSnapshot>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick(): Promise<void> {
      try {
        const r = await fetch('/api/health', { cache: 'no-store' });
        if (!r.ok) {
          if (!cancelled) setSnap(s => ({ ...s, status: 'down' }));
          return;
        }
        const j = (await r.json()) as Record<string, unknown>;
        const backend = (j.backend ?? {}) as Record<string, unknown>;
        const status = j.status === 'ok' && backend.status === 'ok'
          ? 'ok'
          : (j.status === 'degraded' || backend.status === 'unreachable') ? 'degraded' : 'down';
        if (!cancelled) {
          setSnap({
            status: status as HealthSnapshot['status'],
            scpi_reachable: typeof backend.scpi_reachable === 'boolean'
              ? backend.scpi_reachable : null,
            demo: typeof backend.demo === 'boolean' ? backend.demo : null,
            version: typeof backend.version === 'string' ? backend.version : null,
            uptime_s: typeof backend.uptime_s === 'number' ? backend.uptime_s : null,
            raw: j,
          });
        }
      } catch {
        if (!cancelled) setSnap(s => ({ ...s, status: 'down' }));
      } finally {
        if (!cancelled) timer = setTimeout(tick, pollMs);
      }
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pollMs]);

  return snap;
}
