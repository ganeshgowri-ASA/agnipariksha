'use client';

import { useCallback, useEffect, useState } from 'react';
import { Cpu, PowerOff, Wifi, WifiOff, AlertCircle } from 'lucide-react';

interface DeviceHealth {
  alive?: boolean;
  state?: 'init' | 'connecting' | 'live' | 'demo' | 'down' | 'closed' | string;
  last_error?: string | null;
  last_alive_ms?: number;
  checked_ms?: number;
}

interface Device {
  id: string;
  name: string;
  role: string;
  vendor: string;
  model: string;
  transport: { kind: string; host?: string; port?: number; resource?: string };
  demo: boolean;
  health: DeviceHealth;
}

interface DevicesResponse {
  devices: Device[];
  count: number;
}

const BACKEND =
  (process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000').replace(/\/+$/, '');

function pillClasses(d: Device): string {
  if (d.demo) return 'border-yellow-700/60 bg-yellow-900/30 text-yellow-200';
  const s = d.health.state;
  if (s === 'live') return 'border-green-700/60 bg-green-900/30 text-green-300';
  if (s === 'down' || s === 'closed') return 'border-red-700/60 bg-red-900/30 text-red-300';
  return 'border-gray-700/60 bg-gray-900/40 text-gray-300';
}

function pillIcon(d: Device) {
  if (d.demo) return <PowerOff className="w-3 h-3" aria-hidden />;
  const s = d.health.state;
  if (s === 'live') return <Wifi className="w-3 h-3" aria-hidden />;
  if (s === 'down') return <WifiOff className="w-3 h-3" aria-hidden />;
  if (s === 'connecting') return <Cpu className="w-3 h-3 animate-pulse" aria-hidden />;
  return <AlertCircle className="w-3 h-3" aria-hidden />;
}

function endpoint(d: Device): string {
  if (d.transport.host) return `${d.transport.host}:${d.transport.port ?? ''}`.replace(/:$/, '');
  return d.transport.resource ?? d.transport.kind;
}

export default function DevicePills({ pollMs = 5000 }: { pollMs?: number }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`${BACKEND}/api/devices`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j: DevicesResponse = await r.json();
      setDevices(j.devices ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [pollMs, refresh]);

  const toggle = useCallback(async (d: Device) => {
    const next = d.demo ? 'live' : 'demo';
    try {
      await fetch(`${BACKEND}/api/devices/${d.id}/mode`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: next }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [refresh]);

  if (error) {
    return (
      <div className="text-[11px] text-red-300" title={error}>
        device registry unreachable
      </div>
    );
  }
  if (devices.length === 0) {
    return <div className="text-[11px] text-gray-500">no devices configured</div>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {devices.map((d) => {
        const label = d.demo ? 'DEMO' : (d.health.state ?? 'unknown').toUpperCase();
        const title =
          `${d.name} · ${endpoint(d)} · ${d.transport.kind}` +
          (d.health.last_error ? `\n${d.health.last_error}` : '');
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => toggle(d)}
            className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors hover:brightness-110 ${pillClasses(d)}`}
            title={title}
            aria-pressed={!d.demo}
            aria-label={`Toggle ${d.name} between live and demo`}
          >
            {pillIcon(d)}
            <span className="font-mono">{d.name}</span>
            <span className="opacity-80">·</span>
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
