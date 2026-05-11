'use client';

import { useMemo, useRef, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { LiveReading } from '@/app/page';

interface TanstackDataTableProps {
  readings: ReadonlyArray<LiveReading>;
  testName: string;
}

interface Row {
  index: number;
  timestamp: number;
  voltage: number;
  current: number;
  power: number;
  temperature: number | null;
}

const columns: ColumnDef<Row>[] = [
  {
    accessorKey: 'index',
    header: '#',
    cell: (info) => (
      <span className="text-gray-500">{info.getValue<number>()}</span>
    ),
  },
  {
    accessorKey: 'timestamp',
    header: 'Timestamp',
    cell: (info) => (
      <span className="font-mono text-gray-400">
        {new Date(info.getValue<number>()).toLocaleTimeString()}
      </span>
    ),
  },
  {
    accessorKey: 'voltage',
    header: 'Voltage (V)',
    cell: (info) => (
      <span className="font-mono text-blue-300">
        {info.getValue<number>().toFixed(4)}
      </span>
    ),
  },
  {
    accessorKey: 'current',
    header: 'Current (A)',
    cell: (info) => (
      <span className="font-mono text-green-300">
        {info.getValue<number>().toFixed(4)}
      </span>
    ),
  },
  {
    accessorKey: 'power',
    header: 'Power (W)',
    cell: (info) => (
      <span className="font-mono text-yellow-300">
        {info.getValue<number>().toFixed(4)}
      </span>
    ),
  },
  {
    accessorKey: 'temperature',
    header: 'Temp (°C)',
    cell: (info) => {
      const v = info.getValue<number | null>();
      return (
        <span className="font-mono text-red-300">
          {v === null ? '—' : v.toFixed(2)}
        </span>
      );
    },
  },
];

function toCsv(rows: ReadonlyArray<Row>): string {
  const header =
    'Index,Timestamp,DateTime,Voltage(V),Current(A),Power(W),Temperature(C)';
  const body = rows.map((r) =>
    [
      r.index,
      r.timestamp,
      new Date(r.timestamp).toISOString(),
      r.voltage,
      r.current,
      r.power,
      r.temperature ?? '',
    ].join(','),
  );
  return [header, ...body].join('\n');
}

export default function TanstackDataTable({
  readings,
  testName,
}: TanstackDataTableProps) {
  const [globalFilter, setGlobalFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);

  const data = useMemo<Row[]>(
    () =>
      readings.map((r, i) => ({
        index: i + 1,
        timestamp: r.timestamp,
        voltage: r.voltage,
        current: r.current,
        power: r.power,
        temperature: r.temperature ?? null,
      })),
    [readings],
  );

  const table = useReactTable<Row>({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _columnId, filterValue) => {
      const needle = String(filterValue).toLowerCase();
      if (!needle) return true;
      return Object.values(row.original).some((v) =>
        String(v).toLowerCase().includes(needle),
      );
    },
  });

  const rows = table.getRowModel().rows;
  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 12,
  });

  const exportCsv = () => {
    const blob = new Blob([toCsv(rows.map((r) => r.original))], {
      type: 'text/csv',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${testName.replace(/\s+/g, '_')}_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const virtualItems = virtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
      : 0;

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 flex flex-col h-[calc(100vh-260px)] min-h-[320px]">
      <div className="flex items-center justify-between p-3 border-b border-gray-700">
        <span className="text-sm font-medium text-gray-300">
          {data.length.toLocaleString()} measurements
          {globalFilter && (
            <span className="text-gray-500 ml-2">
              · {rows.length.toLocaleString()} filtered
            </span>
          )}
        </span>
        <div className="flex gap-2">
          <input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="Filter…"
            className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 w-40"
          />
          <button
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="px-3 py-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white text-xs rounded transition-colors"
          >
            ↓ Export CSV
          </button>
        </div>
      </div>

      <div ref={parentRef} className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-gray-900 z-10">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-gray-700">
                {hg.headers.map((header) => {
                  const sort = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      className="px-3 py-2 text-left font-medium text-gray-400 select-none cursor-pointer hover:text-gray-200"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      {sort === 'asc' ? ' ▲' : sort === 'desc' ? ' ▼' : ''}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr>
                <td style={{ height: paddingTop }} colSpan={columns.length} />
              </tr>
            )}
            {virtualItems.map((vRow) => {
              const row = rows[vRow.index];
              return (
                <tr
                  key={row.id}
                  className="border-b border-gray-800 hover:bg-gray-800/50"
                  style={{ height: 28 }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-1">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr>
                <td style={{ height: paddingBottom }} colSpan={columns.length} />
              </tr>
            )}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-12 text-center text-gray-500 text-xs"
                >
                  No measurements yet — start the test or wait for data.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
