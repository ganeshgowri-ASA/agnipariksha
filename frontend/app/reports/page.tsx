'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '@/components/AppShell';

// Tab 5 — IEC report. The backend renders a PDF and an HTML twin from one
// template; this embeds the HTML twin and links the PDF. DEMO-only; run ids
// come from GET /api/reports. Degrades gracefully when the backend is down
// (Playwright's dead-port run).
const BACKEND = (process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000').replace(/\/+$/, '');

interface ReportSummary { run_id: string; module_id: string; overall: string; tests: number }
const FALLBACK: ReportSummary = { run_id: 'DEMO-RUN-001', module_id: 'PV-MOD-001', overall: 'FAIL', tests: 5 };

function pillClass(v: string): string {
  const tone = v === 'PASS' ? 'bg-emerald-600' : v === 'FAIL' ? 'bg-red-600' : 'bg-amber-600';
  return `inline-block px-2 py-0.5 rounded-full text-white text-xs font-bold ${tone}`;
}

export default function ReportsPage() {
  const [runs, setRuns] = useState<ReportSummary[]>([]);
  const [runId, setRunId] = useState('');
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${BACKEND}/api/reports`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as ReportSummary[];
      setRuns(data);
      setOffline(false);
      setRunId((p) => p || data[0]?.run_id || FALLBACK.run_id);
    } catch {
      setRuns([FALLBACK]);
      setOffline(true);
      setRunId((p) => p || FALLBACK.run_id);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(() => runs.find((r) => r.run_id === runId), [runs, runId]);
  const htmlUrl = runId ? `${BACKEND}/api/reports/${runId}.html` : '';
  const pdfUrl = runId ? `${BACKEND}/api/reports/${runId}.pdf` : '';

  return (
    <AppShell title="Reports" subtitle="IEC-formatted report · PDF + HTML twin · DEMO">
      <div className="p-6 space-y-4" data-testid="reports-root">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="reports-run" className="text-sm text-muted">Run</label>
          <select
            id="reports-run" value={runId} onChange={(e) => setRunId(e.target.value)}
            data-testid="reports-run-select"
            className="bg-surface-2 border border-app rounded px-2 py-1 text-sm text-app"
          >
            {runs.map((r) => <option key={r.run_id} value={r.run_id}>{r.run_id} — {r.module_id}</option>)}
          </select>
          {selected && <span className={pillClass(selected.overall)}>{selected.overall}</span>}
          <a
            href={pdfUrl || undefined} target="_blank" rel="noreferrer" data-testid="reports-pdf-link"
            className="ml-auto px-3 py-1.5 rounded text-xs font-medium bg-orange-600 hover:bg-orange-500 text-white"
          >
            Download PDF
          </a>
        </div>

        {offline && (
          <div
            className="rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 text-xs p-2"
            data-testid="reports-offline"
          >
            Backend unreachable at <code>{BACKEND}</code>. Showing the demo run id — start the API to render the report.
          </div>
        )}

        <iframe
          key={runId} title="IEC report HTML twin" src={htmlUrl} data-testid="reports-iframe"
          className="w-full h-[calc(100vh-15rem)] bg-white rounded border border-app"
        />
      </div>
    </AppShell>
  );
}
