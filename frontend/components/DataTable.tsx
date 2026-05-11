'use client';

import { useState, useMemo } from 'react';
import type { LiveReading } from '@/app/page';

interface DataTableProps {
  readings: LiveReading[];
  testName: string;
}

export default function DataTable({ readings, testName }: DataTableProps) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const PAGE_SIZE = 50;

  const filtered = useMemo(() => {
    if (!search) return readings;
    const s = parseFloat(search);
    return readings.filter(r => r.voltage === s || r.current === s || r.power === s);
  }, [readings, search]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageData = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const exportCSV = () => {
    const header = 'Timestamp,DateTime,Voltage(V),Current(A),Power(W),Temperature(°C)';
    const rows = readings.map(r =>
      `${r.timestamp},${new Date(r.timestamp).toISOString()},${r.voltage},${r.current},${r.power},${r.temperature ?? ''}`
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `${testName.replace(/\s+/g, '_')}_${Date.now()}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700">
      <div className="flex items-center justify-between p-3 border-b border-gray-700">
        <span className="text-sm font-medium text-gray-300">
          {readings.length.toLocaleString()} measurements recorded
        </span>
        <div className="flex gap-2">
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Filter..."
            className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 w-24"
          />
          <button onClick={exportCSV}
            className="px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded transition-colors">
            ↓ CSV
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-400 border-b border-gray-700">
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">Time</th>
              <th className="px-3 py-2 text-right font-medium">Voltage (V)</th>
              <th className="px-3 py-2 text-right font-medium">Current (A)</th>
              <th className="px-3 py-2 text-right font-medium">Power (W)</th>
              <th className="px-3 py-2 text-right font-medium">Temp (°C)</th>
            </tr>
          </thead>
          <tbody>
            {pageData.map((r, i) => (
              <tr key={r.timestamp} className={`border-b border-gray-800 hover:bg-gray-800/50 ${
                i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-900/50'
              }`}>
                <td className="px-3 py-1.5 text-gray-500">{(page - 1) * PAGE_SIZE + i + 1}</td>
                <td className="px-3 py-1.5 text-gray-400 font-mono">
                  {new Date(r.timestamp).toLocaleTimeString()}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-blue-300">{r.voltage.toFixed(4)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-green-300">{r.current.toFixed(4)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-yellow-300">{r.power.toFixed(4)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-red-300">{r.temperature?.toFixed(2) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between p-3 border-t border-gray-700">
          <span className="text-xs text-gray-500">Page {page} of {totalPages}</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-xs rounded">
              ← Prev
            </button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-xs rounded">
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
