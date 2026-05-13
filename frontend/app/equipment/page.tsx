'use client';

import { useCallback, useEffect, useState } from 'react';

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

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8000';

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

export default function EquipmentPage() {
  const [rows, setRows] = useState<EquipmentHealth[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`${API_BASE}/api/reliability/equipment`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: EquipmentHealth[] = await r.json();
      setRows(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <main className="p-6 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Equipment Reliability</h1>
        <button
          onClick={() => void load()}
          className="px-3 py-1 rounded bg-slate-700 text-white hover:bg-slate-600"
        >
          Refresh
        </button>
      </header>

      {err && (
        <div className="rounded border border-red-400 bg-red-50 p-3 text-red-700">
          {err}
        </div>
      )}

      {loading && !rows.length ? (
        <div className="text-slate-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-slate-500">
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
                className="rounded-lg border bg-white p-4 shadow-sm space-y-2"
              >
                <div className="flex items-center justify-between">
                  <h2 className="font-mono text-sm font-semibold">
                    {r.equipment_id}
                  </h2>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-semibold ${pill.cls}`}
                  >
                    {pill.label}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-1 text-sm">
                  <dt className="text-slate-500">Failures</dt>
                  <dd>{r.failures}</dd>
                  <dt className="text-slate-500">MTBF</dt>
                  <dd>{fmtHours(r.mtbf_hours)}</dd>
                  <dt className="text-slate-500">MTTR</dt>
                  <dd>{fmtHours(r.mttr_hours)}</dd>
                  <dt className="text-slate-500">Availability</dt>
                  <dd>{(r.availability * 100).toFixed(2)}%</dd>
                  <dt className="text-slate-500">Risk</dt>
                  <dd>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 rounded bg-slate-200 overflow-hidden">
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
                  <dt className="text-slate-500">Next service</dt>
                  <dd>{fmtDate(r.next_service_due)}</dd>
                  <dt className="text-slate-500">Weibull k / λ</dt>
                  <dd>
                    {r.weibull_shape
                      ? `${r.weibull_shape.toFixed(2)} / ${fmtHours(
                          r.weibull_scale_hours,
                        )}`
                      : '—'}
                  </dd>
                </dl>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
