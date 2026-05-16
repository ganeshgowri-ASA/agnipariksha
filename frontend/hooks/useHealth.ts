'use client';

import { useEffect, useState } from 'react';

export type DeviceState = 'ok' | 'fail' | 'unknown';

export interface HealthSnapshot {
  status: 'ok' | 'degraded' | 'down' | 'unknown';
  scpi_reachable: boolean | null;
  demo: boolean | null;
  mode: 'demo' | 'live' | null;
  version: string | null;
  uptime_s: number | null;
  scpi: DeviceState;
  dmm: DeviceState;
  chamber: DeviceState;
  raw?: unknown;
}

const INITIAL: HealthSnapshot = {
  status: 'unknown',
  scpi_reachable: null,
  demo: null,
  mode: null,
  version: null,
  uptime_s: null,
  scpi: 'unknown',
  dmm: 'unknown',
  chamber: 'unknown',
};

function toDeviceState(v: unknown): DeviceState {
  return v === 'ok' || v === 'fail' ? v : 'unknown';
}

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
        // /api/health frontend route wraps the backend payload under .backend.
        // The backend itself reports {status: ok|degraded, ...}. Treat the
        // wrapper's .status as the outer transport health.
        const backendStatus = backend.status;
        const status: HealthSnapshot['status'] =
          j.status === 'ok' && (backendStatus === 'ok' || backendStatus === undefined)
            ? 'ok'
            : (j.status === 'degraded'
                || backendStatus === 'degraded'
                || backendStatus === 'unreachable')
                ? 'degraded'
                : 'down';
        const modeRaw = backend.mode;
        const mode: HealthSnapshot['mode'] =
          modeRaw === 'demo' || modeRaw === 'live' ? modeRaw : null;
        if (!cancelled) {
          setSnap({
            status,
            scpi_reachable: typeof backend.scpi_reachable === 'boolean'
              ? backend.scpi_reachable : null,
            demo: typeof backend.demo === 'boolean' ? backend.demo : null,
            mode,
            version: typeof backend.version === 'string' ? backend.version : null,
            uptime_s: typeof backend.uptime_s === 'number' ? backend.uptime_s : null,
            scpi: toDeviceState(backend.scpi),
            dmm: toDeviceState(backend.dmm),
            chamber: toDeviceState(backend.chamber),
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

// ---------------------------------------------------------------------------
// useSmoke — polls /api/scpi/smoke on the backend directly. Used by the
// Status Tower to render per-device IDN lamps (SCPI / Chamber / DMM).
// ---------------------------------------------------------------------------

export interface SmokeDevice {
  id: string;
  name: string;
  role: string;
  kind: string;
  demo: boolean;
  ok: boolean;
  idn: string;
  error: string | null;
  elapsed_ms: number;
}

export interface SmokeSnapshot {
  ok: boolean | null;
  mode: 'demo' | 'live' | null;
  devices: SmokeDevice[];
  loaded: boolean;
  error: string | null;
  /** Look up a device by role (dc_source | chamber | dmm | …). */
  byRole: (role: string) => SmokeDevice | undefined;
}

const SMOKE_INITIAL: SmokeSnapshot = {
  ok: null,
  mode: null,
  devices: [],
  loaded: false,
  error: null,
  byRole: () => undefined,
};

const BACKEND = (
  ((typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_BACKEND_HTTP_URL : undefined)
    ?? 'http://localhost:8000') as string
).replace(/\/+$/, '');

export function useSmoke(pollMs: number = 10_000): SmokeSnapshot {
  const [snap, setSnap] = useState<SmokeSnapshot>(SMOKE_INITIAL);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick(): Promise<void> {
      try {
        const r = await fetch(`${BACKEND}/api/scpi/smoke`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) {
          if (!cancelled) {
            setSnap(s => ({ ...s, loaded: true, error: `HTTP ${r.status}` }));
          }
          return;
        }
        const j = (await r.json()) as {
          ok: boolean;
          mode: 'demo' | 'live';
          devices: SmokeDevice[];
        };
        if (!cancelled) {
          const devices = Array.isArray(j.devices) ? j.devices : [];
          setSnap({
            ok: typeof j.ok === 'boolean' ? j.ok : null,
            mode: j.mode === 'demo' || j.mode === 'live' ? j.mode : null,
            devices,
            loaded: true,
            error: null,
            byRole: (role: string) => devices.find(d => d.role === role),
          });
        }
      } catch (e) {
        if (!cancelled) {
          setSnap(s => ({
            ...s,
            loaded: true,
            error: e instanceof Error ? e.message : String(e),
          }));
        }
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
