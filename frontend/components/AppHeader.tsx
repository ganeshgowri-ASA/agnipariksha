'use client';

import Link from 'next/link';
import { Activity, Flame, Cpu, PowerOff, Wifi, WifiOff, Ticket as TicketIcon } from 'lucide-react';
import { NotificationsBell } from './notifications/NotificationsDrawer';
import { useHealth } from '@/hooks/useHealth';
import { useNotifications } from './notifications/NotificationsStore';

interface AppHeaderProps {
  wsStatus: 'connecting' | 'connected' | 'disconnected' | 'demo';
  demoMode: boolean;
  onToggleDemo: () => void;
  itechHost?: string;
  statusCounts: { running: number; pass: number; fail: number };
}

const PV_HOST_DEFAULT = '192.168.200.100:30000';

export default function AppHeader({
  wsStatus, demoMode, onToggleDemo,
  itechHost = PV_HOST_DEFAULT, statusCounts,
}: AppHeaderProps) {
  const isLive = wsStatus === 'connected';
  const isOffline = wsStatus === 'disconnected';
  const health = useHealth(5_000);
  const healthCls =
    health.status === 'ok'       ? 'border-green-700/60 bg-green-900/30 text-green-300'
    : health.status === 'degraded' ? 'border-yellow-700/60 bg-yellow-900/30 text-yellow-200'
    : health.status === 'down'   ? 'border-red-700/60 bg-red-900/30 text-red-300'
    :                              'border-gray-700/60 bg-gray-900/40 text-gray-300';
  const healthLabel =
    health.status === 'ok'       ? 'System OK'
    : health.status === 'degraded' ? 'Degraded'
    : health.status === 'down'   ? 'Backend down'
    :                              'Checking…';

  return (
    <header className="bg-gradient-to-r from-gray-950 via-gray-900 to-gray-950 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
      {/* Brand lockup */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-gradient-to-br from-orange-500 to-red-600 rounded-md flex items-center justify-center shadow-lg shadow-orange-500/20">
            <Flame className="w-5 h-5 text-white" aria-hidden />
          </div>
          <div className="leading-tight">
            <h1 className="text-base font-bold text-white tracking-tight">Agnipariksha</h1>
            <p className="text-[10px] uppercase tracking-[0.18em] text-gray-400">
              Shreshtata Power Supplies · PV Reliability Test Station
            </p>
          </div>
        </div>

        {/* ITECH connection pill */}
        <div
          className={`hidden md:inline-flex items-center gap-2 text-[11px] font-medium px-2.5 py-1 rounded-full border ${
            isLive
              ? 'border-green-700/60 bg-green-900/30 text-green-300'
              : isOffline
                ? 'border-red-700/60 bg-red-900/30 text-red-300'
                : 'border-yellow-700/60 bg-yellow-900/30 text-yellow-200'
          }`}
          title={`ITECH PV6000 @ ${itechHost} — ${wsStatus.toUpperCase()}`}
        >
          {isLive ? <Wifi className="w-3 h-3" /> : isOffline ? <WifiOff className="w-3 h-3" /> : <Cpu className="w-3 h-3" />}
          <span className="font-mono">PV6000 · {itechHost}</span>
        </div>
      </div>

      {/* Right cluster */}
      <div className="flex items-center gap-3">
        <div className="hidden sm:flex gap-1.5 text-[11px] font-medium">
          <span className="px-2 py-1 bg-blue-900/40 text-blue-200 rounded">{statusCounts.running} Running</span>
          <span className="px-2 py-1 bg-green-900/40 text-green-200 rounded">{statusCounts.pass} Pass</span>
          <span className="px-2 py-1 bg-red-900/40 text-red-200 rounded">{statusCounts.fail} Fail</span>
        </div>

        <button
          type="button" onClick={onToggleDemo}
          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition-colors ${
            demoMode
              ? 'bg-yellow-700/50 text-yellow-100 hover:bg-yellow-700/70'
              : 'bg-gray-800 text-gray-200 hover:bg-gray-700'
          }`}
          aria-pressed={demoMode}
          aria-label="Toggle demo / live mode"
        >
          {demoMode ? <PowerOff className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5" />}
          {demoMode ? 'DEMO' : 'LIVE'}
        </button>

        <span
          className={`hidden md:inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border ${healthCls}`}
          title={
            health.status === 'unknown'
              ? 'Polling /api/health…'
              : `version ${health.version ?? '?'} · SCPI ${health.scpi_reachable ? 'reachable' : 'unreachable'} · uptime ${health.uptime_s ?? '?'}s`
          }
        >
          <Activity className="w-3 h-3" />
          {healthLabel}
        </span>

        <Link
          href="/tickets"
          data-testid="nav-tickets"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold text-orange-200 border border-orange-700/60 bg-orange-900/30 hover:bg-orange-900/50"
        >
          <TicketIcon className="w-3.5 h-3.5" />
          Tickets
        </Link>

        <ForceErrorButton />

        <NotificationsBell />

        <span
          className={`w-2.5 h-2.5 rounded-full ${
            isLive ? 'bg-green-400 animate-pulse' : isOffline ? 'bg-red-400' : 'bg-yellow-400'
          }`}
          title={`WebSocket: ${wsStatus}`}
          aria-label={`WebSocket ${wsStatus}`}
        />
      </div>
    </header>
  );
}


function ForceErrorButton() {
  const { push } = useNotifications();
  return (
    <button
      type="button"
      data-testid="force-error-btn"
      title="Emit a forced error toast (dev/QA)"
      onClick={() =>
        push({
          severity: "error",
          source: "system",
          title: "Forced error: SCPI command failed",
          message: "SOUR:CURR returned -113 (Undefined header). Use this to raise a ticket.",
        })
      }
      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold border border-red-700/60 bg-red-900/30 text-red-200 hover:bg-red-900/50"
    >
      Force error
    </button>
  );
}
