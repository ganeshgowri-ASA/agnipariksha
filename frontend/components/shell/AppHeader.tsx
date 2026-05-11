'use client';

import { useState, useTransition } from 'react';
import { AlertOctagon, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { emergencyStop } from '@/lib/api';
import type { WsStatus } from '@/hooks/useWebSocket';

export interface AppHeaderProps {
  deviceIp: string;
  devicePort: string | number;
  wsStatus: WsStatus;
  demoMode: boolean;
  onToggleDemo: () => void;
}

const BRAND_TITLE = 'Shreshtata Power Supplies';
const PRODUCT_TITLE = 'Agnipariksha — PV Reliability Test Station';

function statusMeta(status: WsStatus): { label: string; tone: 'ok' | 'warn' | 'fault' | 'info'; pulse: boolean } {
  switch (status) {
    case 'connected':    return { label: 'LINK OK',    tone: 'ok',    pulse: true };
    case 'demo':         return { label: 'SIMULATION', tone: 'info',  pulse: false };
    case 'connecting':   return { label: 'LINKING',    tone: 'warn',  pulse: true };
    case 'disconnected':
    default:             return { label: 'OFFLINE',    tone: 'fault', pulse: true };
  }
}

export function AppHeader({
  deviceIp,
  devicePort,
  wsStatus,
  demoMode,
  onToggleDemo,
}: AppHeaderProps) {
  const meta = statusMeta(wsStatus);
  const [pending, startTransition] = useTransition();
  const [estopResult, setEstopResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const handleEstop = () => {
    const confirmed = typeof window === 'undefined'
      ? true
      : window.confirm('Trigger EMERGENCY STOP? This cuts output on the ITECH PV6000 immediately.');
    if (!confirmed) return;
    startTransition(async () => {
      const result = await emergencyStop();
      setEstopResult(result);
      window.setTimeout(() => setEstopResult(null), 6000);
    });
  };

  return (
    <header className="border-b border-steel-700 bg-panel-raised/95 px-6 py-3 shadow-inset-panel backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            aria-hidden
            className="flex h-9 w-9 items-center justify-center rounded-md bg-gradient-to-br from-agni-orange to-agni-ember font-bold text-black shadow-[0_0_10px_rgba(255,122,24,0.45)]"
          >
            Ap
          </div>
          <div className="leading-tight">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-agni-amber">
              {BRAND_TITLE}
            </div>
            <h1 className="text-sm font-semibold text-steel-50 sm:text-base">
              {PRODUCT_TITLE}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 rounded-md border border-steel-700 bg-panel-inset px-3 py-1.5 font-mono text-xs text-steel-200">
            {wsStatus === 'connected' ? (
              <Wifi className="h-3.5 w-3.5 text-signal-ok" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-steel-400" />
            )}
            <span className="text-steel-400">ITECH</span>
            <span>{deviceIp}</span>
            <span className="text-steel-500">:</span>
            <span>{devicePort}</span>
          </div>

          <div className="flex items-center gap-2">
            <span
              aria-label={meta.label}
              className={cn(
                'h-3 w-3 rounded-full ring-1 ring-black/50',
                meta.tone === 'ok'    && 'bg-signal-ok    shadow-led-ok',
                meta.tone === 'warn'  && 'bg-signal-warn',
                meta.tone === 'fault' && 'bg-signal-fault shadow-led-fault',
                meta.tone === 'info'  && 'bg-signal-info',
                meta.pulse && 'animate-pulse-led'
              )}
            />
            <Badge variant={meta.tone}>{meta.label}</Badge>
          </div>

          <Button
            size="sm"
            variant={demoMode ? 'primary' : 'outline'}
            onClick={onToggleDemo}
            aria-pressed={demoMode}
            title={demoMode ? 'Click to switch to LIVE hardware' : 'Click to switch to DEMO data'}
          >
            <span className={cn('inline-block h-2 w-2 rounded-full', demoMode ? 'bg-black' : 'bg-signal-ok')} />
            {demoMode ? 'DEMO' : 'LIVE'}
          </Button>

          <Button
            size="md"
            variant="danger"
            onClick={handleEstop}
            disabled={pending}
            className="font-bold tracking-wider"
            aria-label="Emergency Stop"
          >
            <AlertOctagon className="h-4 w-4" aria-hidden />
            {pending ? 'STOPPING…' : 'E-STOP'}
          </Button>
        </div>
      </div>

      {estopResult && (
        <div
          role="status"
          className={cn(
            'mt-2 rounded-md border px-3 py-1.5 text-xs',
            estopResult.ok
              ? 'border-signal-ok/40 bg-signal-ok/10 text-signal-ok'
              : 'border-signal-fault/40 bg-signal-fault/10 text-signal-fault'
          )}
        >
          {estopResult.ok ? 'E-STOP acknowledged by device.' : `E-STOP failed: ${estopResult.message ?? 'unknown error'}`}
        </div>
      )}
    </header>
  );
}

export default AppHeader;
