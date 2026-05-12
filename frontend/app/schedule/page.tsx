'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import GanttChart, { type ScheduleSlot } from '@/components/GanttChart';

type ViewMode = 'weekly' | 'monthly';

type ConflictDetail = {
  error: 'conflict';
  conflicts: ScheduleSlot[];
};

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function toLocalInput(d: Date): string {
  // datetime-local expects YYYY-MM-DDTHH:mm (local time, no tz)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(s: string): Date {
  return new Date(s);
}

function shiftAnchor(anchor: Date, mode: ViewMode, dir: -1 | 1): Date {
  const next = new Date(anchor);
  if (mode === 'weekly') next.setDate(anchor.getDate() + dir * 7);
  else next.setMonth(anchor.getMonth() + dir);
  return next;
}

export default function SchedulePage() {
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [mode, setMode] = useState<ViewMode>('weekly');
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);

  // Create-slot form
  const [equipmentId, setEquipmentId] = useState('rig-1');
  const [runId, setRunId] = useState('run-001');
  const [startStr, setStartStr] = useState<string>(() => toLocalInput(new Date()));
  const [endStr, setEndStr] = useState<string>(() => {
    const d = new Date(); d.setHours(d.getHours() + 2); return toLocalInput(d);
  });
  const [durationH, setDurationH] = useState<number>(2);

  const fetchSlots = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/scheduler/schedules', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as ScheduleSlot[];
      setSlots(Array.isArray(data) ? data : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchSlots(); }, [fetchSlots]);

  const createSlot = useCallback(async () => {
    setConflictWarning(null);
    setError(null);
    const payload = {
      equipment_id: equipmentId,
      run_id: runId,
      start: new Date(startStr).toISOString(),
      end: new Date(endStr).toISOString(),
    };
    const r = await fetch('/api/scheduler/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (r.status === 201) {
      await fetchSlots();
      return;
    }
    if (r.status === 409) {
      const body = (await r.json().catch(() => ({}))) as { detail?: ConflictDetail };
      const c = body.detail?.conflicts?.[0];
      setConflictWarning(
        c ? `Conflict with ${c.run_id} on ${c.equipment_id} (${c.start} → ${c.end})`
          : 'Conflict with existing slot',
      );
      return;
    }
    setError(`Create failed (HTTP ${r.status})`);
  }, [equipmentId, runId, startStr, endStr, fetchSlots]);

  const findNextSlot = useCallback(async () => {
    setError(null);
    setConflictWarning(null);
    const qs = new URLSearchParams({
      equipment_id: equipmentId,
      duration_h: String(durationH),
    });
    const r = await fetch(`/api/scheduler/next-slot?${qs}`);
    if (!r.ok) { setError(`Next-slot failed (HTTP ${r.status})`); return; }
    const body = await r.json();
    if (!body.found) { setError('No slot found within horizon'); return; }
    setStartStr(toLocalInput(new Date(body.start)));
    setEndStr(toLocalInput(new Date(body.end)));
  }, [equipmentId, durationH]);

  const reschedule = useCallback(async (id: string, newStart: Date, newEnd: Date): Promise<boolean> => {
    setConflictWarning(null);
    setError(null);
    // Optimistic update
    const prev = slots;
    setSlots(s => s.map(x => x.id === id
      ? { ...x, start: newStart.toISOString(), end: newEnd.toISOString() }
      : x));
    const r = await fetch(`/api/scheduler/schedules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start: newStart.toISOString(),
        end: newEnd.toISOString(),
      }),
    });
    if (r.status === 200) {
      void fetchSlots();
      return true;
    }
    setSlots(prev); // rollback
    if (r.status === 409) {
      const body = (await r.json().catch(() => ({}))) as { detail?: ConflictDetail };
      const c = body.detail?.conflicts?.[0];
      setConflictWarning(
        c ? `Conflict with ${c.run_id} on ${c.equipment_id}`
          : 'Reschedule conflicts with an existing slot',
      );
    } else {
      setError(`Reschedule failed (HTTP ${r.status})`);
    }
    return false;
  }, [slots, fetchSlots]);

  const deleteSlot = useCallback(async (id: string) => {
    const prev = slots;
    setSlots(s => s.filter(x => x.id !== id));
    const r = await fetch(`/api/scheduler/schedules/${id}`, { method: 'DELETE' });
    if (r.status !== 204) {
      setSlots(prev);
      setError(`Delete failed (HTTP ${r.status})`);
    }
  }, [slots]);

  const visibleSlots = useMemo(
    () => slots.slice().sort((a, b) => a.start.localeCompare(b.start)),
    [slots],
  );

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-6xl mx-auto">
        <header className="mb-4 flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-2xl font-semibold">Scheduler</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMode('weekly')}
              className={`px-3 py-1 rounded text-sm ${mode === 'weekly' ? 'bg-blue-600' : 'bg-gray-800'}`}
              data-testid="view-weekly"
            >Weekly</button>
            <button
              onClick={() => setMode('monthly')}
              className={`px-3 py-1 rounded text-sm ${mode === 'monthly' ? 'bg-blue-600' : 'bg-gray-800'}`}
              data-testid="view-monthly"
            >Monthly</button>
            <a
              href="/api/scheduler/export.ics"
              className="px-3 py-1 rounded text-sm bg-gray-800 hover:bg-gray-700"
              data-testid="export-ics"
            >Export .ics</a>
          </div>
        </header>

        <section className="bg-gray-900 rounded p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <label className="text-sm flex flex-col">
              <span className="text-gray-400 mb-1">Equipment</span>
              <input
                value={equipmentId}
                onChange={e => setEquipmentId(e.target.value)}
                className="bg-gray-800 px-2 py-1 rounded"
                data-testid="form-equipment"
              />
            </label>
            <label className="text-sm flex flex-col">
              <span className="text-gray-400 mb-1">Run ID</span>
              <input
                value={runId}
                onChange={e => setRunId(e.target.value)}
                className="bg-gray-800 px-2 py-1 rounded"
                data-testid="form-runid"
              />
            </label>
            <label className="text-sm flex flex-col">
              <span className="text-gray-400 mb-1">Start</span>
              <input
                type="datetime-local"
                value={startStr}
                onChange={e => setStartStr(e.target.value)}
                className="bg-gray-800 px-2 py-1 rounded"
                data-testid="form-start"
              />
            </label>
            <label className="text-sm flex flex-col">
              <span className="text-gray-400 mb-1">End</span>
              <input
                type="datetime-local"
                value={endStr}
                onChange={e => setEndStr(e.target.value)}
                className="bg-gray-800 px-2 py-1 rounded"
                data-testid="form-end"
              />
            </label>
            <label className="text-sm flex flex-col">
              <span className="text-gray-400 mb-1">Duration (h)</span>
              <input
                type="number"
                min={0.25}
                step={0.25}
                value={durationH}
                onChange={e => setDurationH(parseFloat(e.target.value) || 0)}
                className="bg-gray-800 px-2 py-1 rounded"
                data-testid="form-duration"
              />
            </label>
            <div className="flex gap-2">
              <button
                onClick={findNextSlot}
                className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-sm"
                data-testid="btn-next-slot"
              >Next slot</button>
              <button
                onClick={createSlot}
                className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-sm"
                data-testid="btn-create"
              >Create</button>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => setAnchor(a => shiftAnchor(a, mode, -1))}
              className="px-2 py-1 bg-gray-800 rounded text-sm"
              data-testid="nav-prev"
            >‹</button>
            <button
              onClick={() => setAnchor(new Date())}
              className="px-2 py-1 bg-gray-800 rounded text-sm"
              data-testid="nav-today"
            >Today</button>
            <button
              onClick={() => setAnchor(a => shiftAnchor(a, mode, 1))}
              className="px-2 py-1 bg-gray-800 rounded text-sm"
              data-testid="nav-next"
            >›</button>
            {loading && <span className="text-xs text-gray-400">loading…</span>}
          </div>
        </section>

        {error && (
          <div className="bg-red-900/40 border border-red-800 text-red-200 p-2 rounded mb-3 text-sm" data-testid="error-banner">
            {error}
          </div>
        )}
        {conflictWarning && (
          <div
            className="bg-amber-900/40 border border-amber-700 text-amber-200 p-2 rounded mb-3 text-sm"
            role="alert"
            data-testid="conflict-warning"
          >
            ⚠ {conflictWarning}
          </div>
        )}

        <GanttChart
          slots={slots}
          mode={mode}
          anchor={anchor}
          onReschedule={reschedule}
          chartWidth={mode === 'monthly' ? 1100 : 920}
        />

        <section className="mt-6">
          <h2 className="text-lg font-medium mb-2">Schedules</h2>
          <table className="w-full text-sm">
            <thead className="text-gray-400">
              <tr>
                <th className="text-left p-1">Run</th>
                <th className="text-left p-1">Equipment</th>
                <th className="text-left p-1">Start</th>
                <th className="text-left p-1">End</th>
                <th className="text-left p-1">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody data-testid="slot-table">
              {visibleSlots.map(s => (
                <tr key={s.id} className="border-t border-gray-800">
                  <td className="p-1">{s.run_id}</td>
                  <td className="p-1">{s.equipment_id}</td>
                  <td className="p-1">{new Date(s.start).toLocaleString()}</td>
                  <td className="p-1">{new Date(s.end).toLocaleString()}</td>
                  <td className="p-1">{s.status}</td>
                  <td className="p-1">
                    <button
                      onClick={() => void deleteSlot(s.id)}
                      className="text-red-400 hover:text-red-300"
                    >delete</button>
                  </td>
                </tr>
              ))}
              {visibleSlots.length === 0 && (
                <tr><td colSpan={6} className="p-2 text-gray-500 italic">No schedules yet</td></tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
