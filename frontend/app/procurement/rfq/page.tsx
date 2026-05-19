'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '@/components/AppShell';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { ErrorState } from '@/components/ui/States';

type RFQStatus = 'draft' | 'sent' | 'received' | 'accepted' | 'rejected' | 'expired';

interface RFQ {
  id: string;
  rfq_no: string;
  vendor: string;
  items: number;
  total: number;
  status: RFQStatus;
  created_at: string;
}

interface RFQPage {
  items: RFQ[];
  page: number;
  size: number;
  total: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8000';
const PAGE_SIZE = 25;

const STATUS_BADGE: Record<RFQStatus, string> = {
  draft: 'bg-slate-200 text-slate-700',
  sent: 'bg-blue-200 text-blue-800',
  received: 'bg-indigo-200 text-indigo-800',
  accepted: 'bg-emerald-200 text-emerald-800',
  rejected: 'bg-red-200 text-red-800',
  expired: 'bg-amber-200 text-amber-800',
};

const fmtCurrency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function RFQListPage() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RFQPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const url = `${API_BASE}/api/procurement/rfq?page=${page}&size=${PAGE_SIZE}`;
      const r = await fetch(url, { signal, cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData((await r.json()) as RFQPage);
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const columns = useMemo<DataTableColumn<RFQ>[]>(() => [
    {
      key: 'rfq_no',
      header: 'RFQ #',
      cell: (r) => <span className="font-mono">{r.rfq_no}</span>,
    },
    { key: 'vendor', header: 'Vendor', cell: (r) => r.vendor },
    {
      key: 'items',
      header: 'Items',
      headerClassName: 'text-right',
      className: 'text-right font-mono',
      cell: (r) => r.items,
    },
    {
      key: 'total',
      header: 'Total',
      headerClassName: 'text-right',
      className: 'text-right font-mono',
      cell: (r) => fmtCurrency.format(r.total),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <span
          className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[r.status]}`}
        >
          {r.status}
        </span>
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      cell: (r) => <span className="text-muted">{fmtDate(r.created_at)}</span>,
    },
  ], []);

  return (
    <AppShell
      title="Requests for Quotation"
      subtitle="Procurement — outgoing RFQs to vendors"
    >
      <div className="p-6 space-y-4" data-testid="rfq-page">
        {error && (
          <ErrorState
            title="Could not load RFQs"
            error={error}
            onRetry={() => void load()}
          />
        )}

        {!error && (
          <DataTable<RFQ>
            columns={columns}
            data={data?.items ?? []}
            rowKey={(r) => r.id}
            loading={loading}
            skeletonRows={6}
            empty={{
              title: 'No RFQs yet',
              description: 'Quotation requests issued to vendors will appear here.',
            }}
            pagination={{
              page: data?.page ?? page,
              size: data?.size ?? PAGE_SIZE,
              total: data?.total ?? 0,
              onPageChange: setPage,
            }}
          />
        )}
      </div>
    </AppShell>
  );
}
