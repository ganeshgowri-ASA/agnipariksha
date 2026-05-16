'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileText } from 'lucide-react';
import { LoadStateGate } from '@/components/ui/States';

type POStatus =
  | 'draft'
  | 'issued'
  | 'acknowledged'
  | 'shipped'
  | 'received'
  | 'closed'
  | 'cancelled';

type PurchaseOrder = {
  id: string;
  po_number: string;
  vendor: string;
  rfq_ref: string | null;
  total: number;
  currency: string;
  status: POStatus;
  eta: string | null;
  created_at: number;
  updated_at: number;
};

type PurchaseOrderPage = {
  items: PurchaseOrder[];
  total: number;
  page: number;
  size: number;
  pages: number;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8000';
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

const STATUS_STYLES: Record<POStatus, string> = {
  draft:        'bg-slate-700 text-slate-100 border-slate-500',
  issued:       'bg-blue-700/40 text-blue-100 border-blue-500/60',
  acknowledged: 'bg-indigo-700/40 text-indigo-100 border-indigo-500/60',
  shipped:      'bg-amber-700/40 text-amber-100 border-amber-500/60',
  received:     'bg-emerald-700/40 text-emerald-100 border-emerald-500/60',
  closed:       'bg-zinc-700/50 text-zinc-200 border-zinc-500/50',
  cancelled:    'bg-red-800/40 text-red-100 border-red-500/60',
};

function formatTotal(total: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(total);
  } catch {
    return `${currency} ${total.toFixed(2)}`;
  }
}

export default function PurchaseOrderListPage() {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(DEFAULT_PAGE_SIZE);
  const [data, setData] = useState<PurchaseOrderPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(
        `${API_BASE}/api/procurement/po?page=${page}&size=${size}`,
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json()) as PurchaseOrderPage;
      setData(body);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, [page, size]);

  useEffect(() => {
    void load();
  }, [load]);

  const pages = data?.pages ?? 0;
  const total = data?.total ?? 0;
  const items = useMemo(() => data?.items ?? [], [data]);

  const start = total === 0 ? 0 : (page - 1) * size + 1;
  const end = Math.min(page * size, total);

  // If the user lands on a page that's now past the end (e.g. after size
  // change), snap them back to the last valid page.
  useEffect(() => {
    if (data && pages > 0 && page > pages) setPage(pages);
  }, [data, pages, page]);

  return (
    <main className="p-6 space-y-6" data-testid="po-page">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/overview"
            className="text-muted hover:text-app inline-flex items-center gap-1.5 text-xs"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Overview
          </Link>
          <div className="w-px h-5 bg-app/40" />
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
              <FileText className="w-4 h-4 text-white" />
            </div>
            <div className="leading-tight">
              <h1 className="text-sm font-bold text-app">Purchase Orders</h1>
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted">
                Procurement · PO Ledger
              </p>
            </div>
          </div>
        </div>
        <span className="text-xs text-muted" data-testid="po-summary">
          {total === 0
            ? 'No purchase orders'
            : `Showing ${start}–${end} of ${total}`}
        </span>
      </header>

      <LoadStateGate
        loading={loading && data === null}
        error={err}
        empty={!loading && !err && total === 0}
        emptyTitle="No purchase orders"
        emptyDescription="Create a PO to see it here."
        onRetry={() => void load()}
      >
        <div className="rounded-lg border border-app bg-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table
              className="w-full text-sm border-collapse"
              data-testid="po-table"
            >
              <thead>
                <tr className="text-left text-muted text-xs uppercase tracking-wider bg-surface-2/60 border-b border-app">
                  <th className="px-3 py-2 font-medium">PO #</th>
                  <th className="px-3 py-2 font-medium">Vendor</th>
                  <th className="px-3 py-2 font-medium">RFQ Ref</th>
                  <th className="px-3 py-2 font-medium text-right">Total</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">ETA</th>
                </tr>
              </thead>
              <tbody data-testid="po-tbody">
                {items.map((po) => (
                  <tr
                    key={po.id}
                    className="border-b border-app/60 hover:bg-surface-2/40"
                    data-testid="po-row"
                  >
                    <td
                      className="px-3 py-2 font-mono text-app"
                      data-testid="po-cell-number"
                    >
                      {po.po_number}
                    </td>
                    <td className="px-3 py-2 text-app">{po.vendor}</td>
                    <td className="px-3 py-2 font-mono text-muted">
                      {po.rfq_ref ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-app">
                      {formatTotal(po.total, po.currency)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] uppercase tracking-wide ${STATUS_STYLES[po.status]}`}
                        data-testid={`po-status-${po.status}`}
                      >
                        {po.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-muted">
                      {po.eta ?? '—'}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && !loading && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-6 text-center text-muted text-xs"
                    >
                      No purchase orders on this page.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div
            className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between p-3 border-t border-app"
            data-testid="po-pagination"
          >
            <div className="flex items-center gap-2 text-xs text-muted">
              <label htmlFor="po-page-size">Page size</label>
              <select
                id="po-page-size"
                data-testid="po-page-size"
                value={size}
                onChange={(e) => {
                  setSize(Number(e.target.value));
                  setPage(1);
                }}
                className="bg-surface-2 border border-app rounded px-2 py-1 text-xs"
              >
                {PAGE_SIZE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="po-prev"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="px-2 py-1 rounded border border-app bg-surface-2 hover:bg-surface-2/70 disabled:opacity-40 text-xs"
              >
                ← Prev
              </button>
              <span className="text-xs text-muted font-mono" data-testid="po-page-indicator">
                Page {pages === 0 ? 0 : page} of {pages}
              </span>
              <button
                type="button"
                data-testid="po-next"
                onClick={() => setPage((p) => (pages === 0 ? p : Math.min(pages, p + 1)))}
                disabled={page >= pages || loading || pages === 0}
                className="px-2 py-1 rounded border border-app bg-surface-2 hover:bg-surface-2/70 disabled:opacity-40 text-xs"
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      </LoadStateGate>
    </main>
  );
}
