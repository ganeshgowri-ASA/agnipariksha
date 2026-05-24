'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useHealth } from '@/hooks/useHealth';
import StatusTower from './StatusTower';
import type { LampState } from './StatusLamp';

/**
 * Shared 4-lamp readiness tower (Power Supply · Backend · Frontend · Cloud/AI)
 * plus a compact CONNECTION panel. Rendered at the top of every test tab that
 * energizes the PSU (TC, HF, LeTID, BDT, RCO — and the EL/PID tabs added by
 * sibling PRs). Each instance polls the same backend endpoints, so every tab
 * reflects the same underlying system-readiness state.
 *
 * Lifted out of ThermalCyclingBasicCheck so the tower is no longer TC-only.
 * The richer Manual-Set / Output / Gate preflight stays on the TC tab.
 */

interface TransportInfo { kind: string; host: string; port: number; demo: boolean; reachable: boolean; probe_ms: number; }
interface IdnInfo { idn: string; demo: boolean; error: string | null; }
interface DevicesPayload { count?: number; }

interface BasicCheckTowerProps {
  /** WebSocket status from the dashboard hook (drives the Frontend lamp). */
  wsStatus?: string;
  /** Dashboard-wide DEMO toggle — keeps a disconnected socket non-blocking. */
  demoMode?: boolean;
}

const BACKEND = (process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000').replace(/\/+$/, '');

async function fetchJson<T>(url: string, timeoutMs = 3000): Promise<{ data?: T; error?: string }> {
  try {
    const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return { data: (await r.json()) as T };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export default function BasicCheckTower({ wsStatus = 'unknown', demoMode = false }: BasicCheckTowerProps) {
  const health = useHealth(5_000);
  const [transport, setTransport] = useState<TransportInfo | null>(null);
  const [transportErr, setTransportErr] = useState<string | null>(null);
  const [idn, setIdn] = useState<IdnInfo | null>(null);
  const [idnErr, setIdnErr] = useState<string | null>(null);
  const [registry, setRegistry] = useState<DevicesPayload | null>(null);
  const [registryErr, setRegistryErr] = useState<string | null>(null);
  const [aiOk, setAiOk] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    const [t, i, d] = await Promise.all([
      fetchJson<TransportInfo>(`${BACKEND}/api/scpi/transport`),
      fetchJson<IdnInfo>(`${BACKEND}/api/scpi/idn`, 5000),
      fetchJson<DevicesPayload>(`${BACKEND}/api/devices`),
    ]);
    if (t.data) setTransport(t.data); setTransportErr(t.error ?? null);
    if (i.data) setIdn(i.data); setIdnErr(i.error ?? null);
    if (d.data) setRegistry(d.data); setRegistryErr(d.error ?? null);
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, 6000);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/ai/ask', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context: 'basic-check ping' }), signal: AbortSignal.timeout(3000),
        });
        if (!cancelled) setAiOk(r.ok);
      } catch { if (!cancelled) setAiOk(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const powerSupplyState: LampState = useMemo(() => {
    if (!transport && !transportErr) return 'gray';
    if (transportErr || idnErr || idn?.error) return 'red';
    if (transport && !transport.reachable && !transport.demo) return 'red';
    if (idn && !idn.demo && /DEMO|SIM/i.test(idn.idn)) return 'red';
    if (transport?.demo || idn?.demo) return 'yellow';
    if (transport?.reachable && idn?.idn) return 'green';
    return 'gray';
  }, [transport, transportErr, idn, idnErr]);

  const backendState: LampState = useMemo(() => {
    if (health.status === 'ok') return (registryErr || registry?.count === 0) ? 'yellow' : 'green';
    if (health.status === 'degraded') return 'yellow';
    if (health.status === 'down') return 'red';
    return 'gray';
  }, [health.status, registry, registryErr]);

  const frontendState: LampState = useMemo(() => {
    if (wsStatus === 'connected') return 'green';
    if (wsStatus === 'demo' || wsStatus === 'connecting') return 'yellow';
    if (wsStatus === 'disconnected') return demoMode ? 'yellow' : 'red';
    return 'gray';
  }, [wsStatus, demoMode]);

  const cloudAiState: LampState = aiOk === null ? 'gray' : aiOk ? 'green' : 'yellow';

  const psDetail = transportErr
    ? `transport check failed: ${transportErr}`
    : transport
      ? `${transport.kind} ${transport.host}:${transport.port} · ${transport.demo ? 'DEMO' : 'LIVE'} · ${transport.reachable ? 'reachable' : 'unreachable'}${idn?.idn ? ` · ${idn.idn.slice(0, 28)}` : ''}`
      : 'probing transport…';

  return (
    <section className="space-y-3" data-testid="basic-check-tower">
      <StatusTower
        lamps={[
          { key: 'power-supply', label: 'Power Supply', state: powerSupplyState, detail: psDetail },
          { key: 'backend',      label: 'Backend',      state: backendState,     detail: health.status === 'unknown' ? 'polling /api/health…' : `health=${health.status}${health.version ? ` · v${health.version}` : ''}` },
          { key: 'frontend',     label: 'Frontend',     state: frontendState,    detail: `ws=${wsStatus}${demoMode ? ' · DEMO toggle ON' : ''}` },
          { key: 'cloud-ai',     label: 'Cloud / AI',   state: cloudAiState,     detail: aiOk === null ? 'pinging /api/ai/ask…' : aiOk ? 'AI endpoint reachable' : 'AI unavailable — non-blocking' },
        ]}
      />

      <div className="text-[11px] text-gray-500">
        <span className="text-emerald-400 font-semibold">green</span> = go ·{' '}
        <span className="text-amber-400 font-semibold">yellow</span> = resolve via{' '}
        <Link href="/help/troubleshooting" className="underline hover:text-amber-300">Help / Q&amp;A</Link> ·{' '}
        <span className="text-rose-400 font-semibold">red</span> = stop ·{' '}
        <span className="text-gray-400 font-semibold">gray</span> = unknown
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4" data-testid="basic-check-connection">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-300 mb-3">Connection</h3>
        <div className="space-y-2">
          <KV label="API health"      value={`${health.status}${health.version ? ` · v${health.version}` : ''}`} bad={health.status === 'down'} warn={health.status === 'degraded'} />
          <KV label="Device registry" value={registryErr ? `unreachable (${registryErr})` : `${registry?.count ?? 0} device(s)`} bad={Boolean(registryErr)} />
          <KV label="WebSocket"       value={wsStatus} warn={wsStatus === 'demo' || wsStatus === 'connecting'} bad={wsStatus === 'disconnected' && !demoMode} />
          <KV label="SCPI transport"  value={transport ? `${transport.kind} ${transport.host}:${transport.port}` : (transportErr ?? 'probing…')} bad={Boolean(transportErr) || (transport ? !transport.reachable && !transport.demo : false)} />
          <KV label="*IDN?"           value={idnErr ?? idn?.error ?? idn?.idn ?? 'querying…'} bad={Boolean(idnErr || idn?.error)} />
          <div className="pt-2">
            <button
              type="button"
              onClick={() => { void refresh(); }}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-gray-200 transition-colors"
            >
              Re-probe
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function KV({ label, value, bad, warn }: { label: string; value: string; bad?: boolean; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-gray-500">{label}</span>
      <span className={`font-mono ${bad ? 'text-rose-400' : warn ? 'text-amber-400' : 'text-gray-200'} truncate text-right`} title={value}>
        {value}
      </span>
    </div>
  );
}
