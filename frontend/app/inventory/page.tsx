'use client';

import { useCallback, useEffect, useState } from 'react';

type SparePart = {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  reorder_level: number;
  reorder_qty: number;
  location: string;
  updated_at: string;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8000';

const blankForm = {
  sku: '',
  name: '',
  quantity: 0,
  reorder_level: 1,
  reorder_qty: 5,
  location: '',
};

export default function InventoryPage() {
  const [parts, setParts] = useState<SparePart[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ ...blankForm });

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/reliability/parts`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setParts(await r.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(
    async (ev: React.FormEvent) => {
      ev.preventDefault();
      setBusy(true);
      setErr(null);
      try {
        const r = await fetch(`${API_BASE}/api/reliability/parts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setForm({ ...blankForm });
        await load();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'create failed');
      } finally {
        setBusy(false);
      }
    },
    [form, load],
  );

  const consume = useCallback(
    async (id: string, count: number) => {
      try {
        const r = await fetch(
          `${API_BASE}/api/reliability/parts/${id}/consume?count=${count}`,
          { method: 'POST' },
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        await load();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'consume failed');
      }
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        const r = await fetch(`${API_BASE}/api/reliability/parts/${id}`, {
          method: 'DELETE',
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        await load();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'delete failed');
      }
    },
    [load],
  );

  const lowStock = (p: SparePart) => p.quantity <= p.reorder_level;

  return (
    <main className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Spare Parts Inventory</h1>
        <span className="text-sm text-slate-500">
          {parts.filter(lowStock).length} low-stock
        </span>
      </header>

      {err && (
        <div className="rounded border border-red-400 bg-red-50 p-3 text-red-700">
          {err}
        </div>
      )}

      <form
        onSubmit={submit}
        className="grid grid-cols-1 md:grid-cols-6 gap-2 rounded border bg-white p-4"
      >
        <input
          required
          placeholder="SKU"
          value={form.sku}
          onChange={(e) => setForm({ ...form, sku: e.target.value })}
          className="border rounded px-2 py-1"
        />
        <input
          required
          placeholder="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="border rounded px-2 py-1 md:col-span-2"
        />
        <input
          type="number"
          min={0}
          placeholder="Qty"
          value={form.quantity}
          onChange={(e) =>
            setForm({ ...form, quantity: Number(e.target.value) })
          }
          className="border rounded px-2 py-1"
        />
        <input
          type="number"
          min={0}
          placeholder="Reorder ≤"
          value={form.reorder_level}
          onChange={(e) =>
            setForm({ ...form, reorder_level: Number(e.target.value) })
          }
          className="border rounded px-2 py-1"
        />
        <button
          disabled={busy}
          className="rounded bg-emerald-600 px-3 py-1 text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          Add part
        </button>
      </form>

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left bg-slate-100">
            <th className="p-2">SKU</th>
            <th className="p-2">Name</th>
            <th className="p-2 text-right">Qty</th>
            <th className="p-2 text-right">Reorder ≤</th>
            <th className="p-2">Location</th>
            <th className="p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {parts.map((p) => (
            <tr
              key={p.id}
              className={
                lowStock(p)
                  ? 'bg-red-50 border-b border-red-200'
                  : 'border-b'
              }
            >
              <td className="p-2 font-mono">{p.sku}</td>
              <td className="p-2">{p.name}</td>
              <td className="p-2 text-right font-mono">
                {p.quantity}
                {lowStock(p) && (
                  <span className="ml-1 rounded bg-red-600 px-1 text-[10px] text-white">
                    LOW
                  </span>
                )}
              </td>
              <td className="p-2 text-right font-mono">{p.reorder_level}</td>
              <td className="p-2">{p.location || '—'}</td>
              <td className="p-2 space-x-2">
                <button
                  onClick={() => void consume(p.id, 1)}
                  className="rounded bg-slate-200 px-2 py-0.5 hover:bg-slate-300"
                >
                  −1
                </button>
                <button
                  onClick={() => void remove(p.id)}
                  className="rounded bg-red-200 px-2 py-0.5 hover:bg-red-300"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {parts.length === 0 && (
            <tr>
              <td colSpan={6} className="p-4 text-center text-slate-500">
                No parts. Add one above.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
