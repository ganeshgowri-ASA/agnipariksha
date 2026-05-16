'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import AppShell from '@/components/AppShell';
import type { ModuleBasicCheck, RunsSummary } from '@/app/api/runs/summary/route';

const POLL_MS = 30_000;

interface HealthSnapshot {
  status?: string;
  backend?: {
    status?: string | number;
    demo?: boolean;
    scpi_reachable?: boolean;
    version?: string;
  };
  timestamp?: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return (await r.json()) as T;
}

function pct(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `${Math.round(n * 100)}%`;
}

function fmtAgo(iso: string | null): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.floor(hrs / 24)} d ago`;
}

function StatusPill({ status }: { status: ModuleBasicCheck['status'] }) {
  const cls =
    status === 'pass'    ? 'bg-emerald-600 text-white' :
    status === 'fail'    ? 'bg-rose-600 text-white' :
    status === 'pending' ? 'bg-amber-500 text-black' :
                           'bg-gray-700 text-gray-200';
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold ${cls}`}>
      {status}
    </span>
  );
}

interface KPITileProps {
  testid: string;
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'warn' | 'danger' | 'ok';
}

function KPITile({ testid, label, value, sub, tone = 'default' }: KPITileProps) {
  const ring =
    tone === 'danger' ? 'border-rose-700' :
    tone === 'warn'   ? 'border-amber-600' :
    tone === 'ok'     ? 'border-emerald-700' :
                        'border-gray-800';
  return (
    <div
      data-testid={testid}
      className={`bg-gray-900 border ${ring} rounded-lg p-4 flex flex-col justify-between min-h-[110px]`}
    >
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-3xl font-semibold text-white tabular-nums leading-none mt-1">
        {value}
      </div>
      {sub && <div className="text-[11px] text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

export default function DashboardOverviewPage() {
  const health = useQuery<HealthSnapshot>({
    queryKey: ['health'],
    queryFn: () => fetchJson<HealthSnapshot>('/api/health'),
    refetchInterval: POLL_MS,
  });

  const summary = useQuery<RunsSummary>({
    queryKey: ['runs', 'summary'],
    queryFn: () => fetchJson<RunsSummary>('/api/runs/summary'),
    refetchInterval: POLL_MS,
  });

  // PSU output safety rule: in demo mode, the PSU output state MUST be OFF.
  // Demo is reported by backend health; we also treat unreachable backend as
  // a forced-OFF state so the operator never sees a stale "ON" indicator.
  const isDemo = health.data?.backend?.demo === true;
  const scpiReachable = health.data?.backend?.scpi_reachable === true;
  const psuOn = !isDemo && scpiReachable;
  const psuLabel = psuOn ? 'ON' : 'OFF';
  const psuTone: KPITileProps['tone'] = psuOn ? 'warn' : 'ok';
  const psuSub = isDemo
    ? 'DEMO — output disabled'
    : !scpiReachable
    ? 'PSU unreachable'
    : 'PV6000 output energized';

  const data = summary.data;
  const passRate = data?.pass_rate ?? 0;
  const alarms = data?.alarms ?? 0;

  return (
    <AppShell
      title="360° Overview"
      subtitle="Last 24 hours · auto-refresh every 30s"
      actions={
        <Link
          href="/dashboard"
          className="text-[11px] text-muted hover:text-app underline-offset-2 hover:underline"
        >
          Open test tabs →
        </Link>
      }
    >
      <div data-testid="dashboard-overview-root" className="p-6 space-y-6">
        <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          <KPITile
            testid="kpi-total-runs"
            label="Total runs (24h)"
            value={summary.isLoading ? '…' : String(data?.total_runs ?? 0)}
            sub={
              data ? `${data.passed} pass · ${data.failed} fail` : 'fetching…'
            }
          />
          <KPITile
            testid="kpi-pass-rate"
            label="Pass rate"
            value={summary.isLoading ? '…' : pct(passRate)}
            sub="excludes in-flight"
            tone={passRate >= 0.95 ? 'ok' : passRate >= 0.8 ? 'default' : 'warn'}
          />
          <KPITile
            testid="kpi-in-flight"
            label="In-flight tests"
            value={summary.isLoading ? '…' : String(data?.in_flight ?? 0)}
            sub="currently running"
          />
          <KPITile
            testid="kpi-alarms"
            label="Alarms"
            value={summary.isLoading ? '…' : String(alarms)}
            sub={alarms === 0 ? 'all clear' : 'requires attention'}
            tone={alarms === 0 ? 'ok' : 'danger'}
          />
          <KPITile
            testid="kpi-psu-state"
            label="PSU output"
            value={psuLabel}
            sub={psuSub}
            tone={psuTone}
          />
          <KPITile
            testid="kpi-modules-checked"
            label="Modules checked"
            value={summary.isLoading ? '…' : String(data?.modules?.length ?? 0)}
            sub="Basic Check log"
          />
        </section>

        <section
          data-testid="basic-check-table"
          className="bg-gray-900 border border-gray-800 rounded-lg"
        >
          <header className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wide">
              Last Basic Check · per Module
            </h2>
            <span className="text-[10px] text-gray-500">
              {data?.generated_at ? `as of ${fmtAgo(data.generated_at)}` : '—'}
            </span>
          </header>
          {summary.isLoading ? (
            <div className="p-4 text-sm text-gray-500">Loading…</div>
          ) : (data?.modules ?? []).length === 0 ? (
            <div className="p-4 text-sm text-gray-500">No Basic Check entries yet.</div>
          ) : (
            <ul className="divide-y divide-gray-800">
              {(data?.modules ?? []).map(m => (
                <li
                  key={m.module_id}
                  data-testid={`module-row-${m.module_id}`}
                  className="px-4 py-2.5 flex items-center justify-between text-sm"
                >
                  <span className="font-mono text-gray-200">{m.module_id}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-[11px] text-gray-500">{fmtAgo(m.checked_at)}</span>
                    <StatusPill status={m.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="text-[10px] text-gray-600 flex gap-3 flex-wrap" data-testid="overview-footer">
          <span>data: /api/health · /api/runs/summary</span>
          <span>·</span>
          <span>poll {POLL_MS / 1000}s</span>
          <span>·</span>
          <span>{isDemo ? 'DEMO mode' : scpiReachable ? 'LIVE' : 'backend offline'}</span>
        </footer>
      </div>
    </AppShell>
  );
}
