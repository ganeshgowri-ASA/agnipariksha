'use client';

import { useCallback, useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { API_BASE, fetchErrorMessage } from '@/lib/apiBase';

type EquipmentHealth = {
  equipment_id: string;
  failures: number;
  mtbf_hours: number | null;
  mttr_hours: number | null;
  availability: number;
  weibull_shape: number | null;
  weibull_scale_hours: number | null;
  risk_score: number;
  next_service_due: string | null;
  last_failure_at: string | null;
};

function healthPill(risk: number, availability: number) {
  if (risk >= 70 || availability < 0.9) {
    return { label: 'Critical', cls: 'bg-red-600 text-white' };
  }
  if (risk >= 40 || availability < 0.97) {
    return { label: 'Warning', cls: 'bg-yellow-500 text-black' };
  }
  return { label: 'Healthy', cls: 'bg-emerald-600 text-white' };
}

function fmtHours(h: number | null): string {
  if (h === null || h === undefined) return '—';
  if (h >= 24) return `${(h / 24).toFixed(1)} d`;
  return `${h.toFixed(1)} h`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

/** Fleet KPIs derived from per-equipment reliability rows. */
export function fleetKpis(rows: EquipmentHealth[]) {
  const withMtbf = rows.filter((r) => r.mtbf_hours !== null);
  const withMttr = rows.filter((r) => r.mttr_hours !== null);
  const avg = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  // Observed run hours ≈ uptime between recorded failures (MTBF × failures).
  const runHours = rows.reduce(
    (acc, r) => acc + (r.mtbf_hours ?? 0) * r.failures,
    0,
  );
  // OEE availability factor: fleet mean availability. Performance/quality
  // factors need per-run telemetry — until then this is the availability
  // component of OEE, labelled as such.
  const availability = avg(rows.map((r) => r.availability));
  return {
    mtbf: avg(withMtbf.map((r) => r.mtbf_hours as number)),
    mttr: avg(withMttr.map((r) => r.mttr_hours as number)),
    runHours: runHours > 0 ? runHours : null,
    oeeAvailability: availability,
  };
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-app bg-surface p-3" title={hint}>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="text-xl font-semibold text-app tabular-nums">{value}</div>
    </div>
  );
}

export default function EquipmentPage() {
  const [rows, setRows] = useState<EquipmentHealth[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/reliability/equipment`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: EquipmentHealth[] = await r.json();
      setRows(data);
      setErr(null);
    } catch (e) {
      setErr(fetchErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll every 30 s when healthy; every 5 s while errored so the page
  // self-heals as soon as the backend comes up (matches the PSU console).
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), err ? 5_000 : 30_000);
    return () => clearInterval(id);
  }, [load, err]);

  const kpis = fleetKpis(rows);

  return (
    <AppShell
      title="Equipment Reliability"
      subtitle="MTBF · MTTR · availability · Weibull risk"
      actions={
        <button
          onClick={() => void load()}
          className="px-3 py-1 rounded text-[11px] font-medium bg-surface-2 text-app border border-app hover:bg-surface"
        >
          Refresh
        </button>
      }
    >
      <main className="p-6 space-y-4">
        {err && (
          <div className="rounded border border-red-400 bg-red-500/10 p-3 text-red-500 text-sm">
            {err}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Fleet MTBF" value={kpis.mtbf ? fmtHours(kpis.mtbf) : '—'} hint="Mean time between failures, fleet average" />
          <Kpi label="Fleet MTTR" value={kpis.mttr ? fmtHours(kpis.mttr) : '—'} hint="Mean time to repair, fleet average" />
          <Kpi label="Observed run hours" value={kpis.runHours ? fmtHours(kpis.runHours) : '—'} hint="Uptime between recorded failures (MTBF × failures)" />
          <Kpi
            label="OEE (availability)"
            value={kpis.oeeAvailability !== null ? `${(kpis.oeeAvailability * 100).toFixed(1)}%` : '—'}
            hint="Availability factor of OEE; performance × quality factors need per-run telemetry"
          />
        </div>

        {loading && !rows.length ? (
          <div className="text-muted">Loading…</div>
        ) : rows.length === 0 && !err ? (
          <div className="text-muted">
            No maintenance history yet. Open a maintenance ticket via{' '}
            <code>/api/reliability/tickets</code>.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rows.map((r) => {
              const pill = healthPill(r.risk_score, r.availability);
              return (
                <article
                  key={r.equipment_id}
                  className="rounded-lg border border-app bg-surface p-4 shadow-sm space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="font-mono text-sm font-semibold text-app">
                      {r.equipment_id}
                    </h2>
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${pill.cls}`}>
                      {pill.label}
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 gap-1 text-sm text-app">
                    <dt className="text-muted">Failures</dt>
                    <dd>{r.failures}</dd>
                    <dt className="text-muted">MTBF</dt>
                    <dd>{fmtHours(r.mtbf_hours)}</dd>
                    <dt className="text-muted">MTTR</dt>
                    <dd>{fmtHours(r.mttr_hours)}</dd>
                    <dt className="text-muted">Availability</dt>
                    <dd>{(r.availability * 100).toFixed(2)}%</dd>
                    <dt className="text-muted">Risk</dt>
                    <dd>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 rounded bg-surface-2 overflow-hidden">
                          <div
                            className={
                              r.risk_score >= 70
                                ? 'h-full bg-red-600'
                                : r.risk_score >= 40
                                ? 'h-full bg-yellow-500'
                                : 'h-full bg-emerald-600'
                            }
                            style={{ width: `${r.risk_score}%` }}
                          />
                        </div>
                        <span>{r.risk_score.toFixed(0)}</span>
                      </div>
                    </dd>
                    <dt className="text-muted">Next service</dt>
                    <dd>{fmtDate(r.next_service_due)}</dd>
                    <dt className="text-muted">Weibull k / λ</dt>
                    <dd>
                      {r.weibull_shape
                        ? `${r.weibull_shape.toFixed(2)} / ${fmtHours(r.weibull_scale_hours)}`
                        : '—'}
                    </dd>
                  </dl>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </AppShell>
  );
}
