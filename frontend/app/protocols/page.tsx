'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import {
  approve,
  ApprovalError,
  ISO17025_REPORT_CHECKLIST,
  lock,
  requestChanges,
  submitForReview,
  type ProtocolState,
} from '@/features/protocol/approval';

const USERS = ['operator.a', 'reviewer.b', 'quality.mgr'];

const SEED: ProtocolState[] = [
  { id: 'tc',  title: 'Thermal Cycling 200',      standard: 'IEC 61215-2:2021 MQT 11',   author: 'operator.a', status: 'draft', version: 0, trail: [] },
  { id: 'hf',  title: 'Humidity Freeze 10',       standard: 'IEC 61215-2:2021 MQT 12',   author: 'operator.a', status: 'draft', version: 0, trail: [] },
  { id: 'bdt', title: 'Bypass Diode Thermal',     standard: 'IEC 61215-2:2021 MQT 18.1', author: 'operator.a', status: 'draft', version: 0, trail: [] },
  { id: 'pid', title: 'PID 96 h',                 standard: 'IEC TS 62804-1',            author: 'operator.a', status: 'draft', version: 0, trail: [] },
  { id: 'letid', title: 'LeTID 162 h',            standard: 'IEC TS 63342',              author: 'operator.a', status: 'draft', version: 0, trail: [] },
  { id: 'gct', title: 'Ground Continuity',        standard: 'IEC 61730-2:2023 MST 13',   author: 'operator.a', status: 'draft', version: 0, trail: [] },
  { id: 'rco', title: 'Reverse Current Overload', standard: 'IEC 61730-2:2023 MST 26',   author: 'operator.a', status: 'draft', version: 0, trail: [] },
];

const STORE = 'agni-protocols-v1';

const STATUS_PILL: Record<ProtocolState['status'], string> = {
  draft: 'bg-surface-2 text-muted',
  in_review: 'bg-sky-600 text-white',
  changes_requested: 'bg-amber-500 text-black',
  approved: 'bg-emerald-600 text-white',
  locked: 'bg-emerald-800 text-white',
};

export default function ProtocolsPage() {
  const [items, setItems] = useState<ProtocolState[]>(SEED);
  const [actor, setActor] = useState(USERS[1]);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) setItems(JSON.parse(raw));
    } catch { /* fresh browser */ }
  }, []);

  const update = (id: string, fn: (p: ProtocolState) => ProtocolState) => {
    setMsg(null);
    setItems((prev) => {
      const next = prev.map((p) => {
        if (p.id !== id) return p;
        try {
          return fn(p);
        } catch (e) {
          setMsg(e instanceof ApprovalError ? e.message : String(e));
          return p;
        }
      });
      try { localStorage.setItem(STORE, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  };

  return (
    <AppShell
      title="Protocol Review & Approval"
      subtitle="Draft → review → approve → issue · four-eyes enforced · ISO/IEC 17025 aligned"
    >
      <div className="p-6 space-y-4 max-w-4xl">
        <div className="flex items-center gap-2 text-xs text-muted">
          Acting as
          <select
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            className="border border-app bg-surface-2 text-app rounded px-2 py-1"
          >
            {USERS.map((u) => <option key={u}>{u}</option>)}
          </select>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="note (needed for change requests)"
            className="flex-1 border border-app bg-surface-2 text-app rounded px-2 py-1"
          />
        </div>
        {msg && (
          <div className="rounded border border-amber-500/60 bg-amber-500/10 text-amber-500 p-2 text-xs">
            {msg}
          </div>
        )}

        <div className="space-y-3">
          {items.map((p) => (
            <article key={p.id} className="rounded-lg border border-app bg-surface p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-app">{p.title}</h2>
                <span className="text-[10px] text-muted">{p.standard}</span>
                <span className={`ml-auto px-2 py-0.5 rounded text-[10px] font-bold uppercase ${STATUS_PILL[p.status]}`}>
                  {p.status.replace('_', ' ')} {p.version > 0 ? `· v${p.version}` : ''}
                </span>
              </div>
              <p className="text-[10px] text-muted">author: {p.author}</p>
              <div className="flex flex-wrap gap-2 text-xs">
                <button onClick={() => update(p.id, (x) => submitForReview(x, actor))}
                  className="px-2 py-0.5 rounded border border-app bg-surface-2 text-app hover:bg-surface">
                  Submit for review
                </button>
                <button onClick={() => update(p.id, (x) => requestChanges(x, actor, note))}
                  className="px-2 py-0.5 rounded border border-app bg-surface-2 text-app hover:bg-surface">
                  Request changes
                </button>
                <button onClick={() => update(p.id, (x) => approve(x, actor))}
                  className="px-2 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-500">
                  Approve
                </button>
                <button onClick={() => update(p.id, (x) => lock(x, actor))}
                  className="px-2 py-0.5 rounded bg-emerald-800 text-white hover:bg-emerald-700">
                  Lock / issue
                </button>
              </div>
              {p.trail.length > 0 && (
                <ol className="text-[10px] text-muted space-y-0.5 border-t border-app pt-2">
                  {p.trail.map((t, i) => (
                    <li key={i}>
                      {t.at.slice(0, 16).replace('T', ' ')} · <span className="text-app">{t.by}</span> — {t.action}
                      {t.note ? ` — “${t.note}”` : ''}
                    </li>
                  ))}
                </ol>
              )}
            </article>
          ))}
        </div>

        <section className="rounded-lg border border-app bg-surface p-4">
          <h2 className="text-xs font-semibold text-app mb-2">
            ISO/IEC 17025 §7.8.2 — report content required before issuing
          </h2>
          <ul className="list-disc pl-5 text-xs text-app space-y-0.5">
            {ISO17025_REPORT_CHECKLIST.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
