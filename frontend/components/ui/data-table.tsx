'use client';

/**
 * Minimal shadcn-style DataTable.
 *
 * Mirrors the public surface of the official shadcn DataTable (columns
 * + data + optional pagination footer) without pulling in
 * @tanstack/react-table. Rendering is intentionally simple so callers
 * can drop in their own row content via column accessors.
 */
import * as React from 'react';
import { EmptyState } from './States';
import { Skeleton } from './skeleton';

export interface DataTableColumn<TRow> {
  key: string;
  header: React.ReactNode;
  cell: (row: TRow) => React.ReactNode;
  className?: string;
  headerClassName?: string;
}

interface DataTableProps<TRow> {
  columns: DataTableColumn<TRow>[];
  data: TRow[];
  rowKey: (row: TRow) => string;
  loading?: boolean;
  skeletonRows?: number;
  empty?: { title: string; description?: string };
  caption?: string;
  pagination?: {
    page: number;
    size: number;
    total: number;
    onPageChange: (page: number) => void;
  };
}

export function DataTable<TRow>({
  columns,
  data,
  rowKey,
  loading,
  skeletonRows = 8,
  empty,
  caption,
  pagination,
}: DataTableProps<TRow>) {
  const totalPages = pagination
    ? Math.max(1, Math.ceil(pagination.total / pagination.size))
    : 1;
  const showEmpty = !loading && data.length === 0;

  return (
    <div className="rounded-lg border border-app bg-surface" data-testid="data-table">
      {caption && <div className="sr-only">{caption}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-app text-left text-muted">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`px-3 py-2 font-medium ${c.headerClassName ?? ''}`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody data-testid="data-table-body">
            {loading &&
              Array.from({ length: skeletonRows }).map((_, i) => (
                <tr key={`skeleton-${i}`} className="border-b border-app/60">
                  {columns.map((c) => (
                    <td key={c.key} className="px-3 py-2">
                      <Skeleton className="h-4 w-full max-w-[180px]" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading &&
              data.map((row) => (
                <tr
                  key={rowKey(row)}
                  className="border-b border-app/40 hover:bg-surface-2"
                >
                  {columns.map((c) => (
                    <td key={c.key} className={`px-3 py-2 ${c.className ?? ''}`}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {showEmpty && (
        <div className="p-4">
          <EmptyState
            title={empty?.title ?? 'No results'}
            description={empty?.description}
          />
        </div>
      )}

      {pagination && pagination.total > 0 && (
        <div
          className="flex items-center justify-between border-t border-app px-3 py-2 text-xs text-muted"
          data-testid="data-table-pagination"
        >
          <span>
            Page {pagination.page} of {totalPages} · {pagination.total} total
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="rounded border border-app px-2 py-1 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
              data-testid="page-prev"
            >
              ← Prev
            </button>
            <button
              type="button"
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              disabled={pagination.page >= totalPages}
              className="rounded border border-app px-2 py-1 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
              data-testid="page-next"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
