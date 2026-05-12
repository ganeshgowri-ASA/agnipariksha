'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { flags } from '@/lib/featureFlags';

// ---------- mock data (reuses shapes from V2-S4/S5/S6 slices) ----------

interface KPIs {
  testsToday: number;
  passRate: number;       // 0..1
  meanRunTimeMin: number;
  fleetMtbfHours: number;
}

interface Equipment {
  id: string;
  name: string;
  status: 'ok' | 'warn' | 'fault';
  detail: string;
}

interface ScheduledRun {
  id: string;
  test: string;
  startHour: number;      // 0..23 today
  durationHours: number;
}

interface Ticket {
  id: string;
  title: string;
  priority: 'P1' | 'P2' | 'P3';
  openedAgo: string;
}

interface SparePart {
  sku: string;
  name: string;
  stock: number;
  reorderAt: number;
}

const MOCK_KPIS: KPIs = {
  testsToday: 7,
  passRate: 0.92,
  meanRunTimeMin: 184,
  fleetMtbfHours: 1420,
};

const MOCK_EQUIPMENT: Equipment[] = [
  { id: 'pv6000-1', name: 'ITECH PV6000 #1', status: 'ok',   detail: 'idle, 24.1 °C'         },
  { id: 'pv6000-2', name: 'ITECH PV6000 #2', status: 'warn', detail: 'fan rpm 2160 (low)'    },
  { id: 'chmb-tc',  name: 'TC Chamber',      status: 'ok',   detail: '−40 → +85 °C, cycle 87' },
  { id: 'chmb-hf',  name: 'HF Chamber',      status: 'ok',   detail: '85% RH stable'         },
  { id: 'dmm-1',    name: 'Keysight DMM',    status: 'ok',   detail: 'last cal 12 d ago'     },
  { id: 'irr-sim',  name: 'Solar Simulator', status: 'fault',detail: 'lamp hours 1980 (>1800)'},
];

const MOCK_SCHEDULE: ScheduledRun[] = [
  { id: 'r1', test: 'TC',  startHour: 8,  durationHours: 6 },
  { id: 'r2', test: 'HF',  startHour: 10, durationHours: 4 },
  { id: 'r3', test: 'DH',  startHour: 13, durationHours: 5 },
  { id: 'r4', test: 'BDT', startHour: 15, durationHours: 1 },
  { id: 'r5', test: 'GCT', startHour: 16, durationHours: 1 },
];

const MOCK_TICKETS: Ticket[] = [
  { id: 'T-201', title: 'PV6000 #2 fan noise',          priority: 'P2', openedAgo: '3 h'  },
  { id: 'T-198', title: 'Solar simulator lamp at EOL',  priority: 'P1', openedAgo: '1 d'  },
  { id: 'T-194', title: 'Calibrate DMM channel 4',      priority: 'P3', openedAgo: '4 d'  },
];

const MOCK_PARTS: SparePart[] = [
  { sku: 'SBR40',   name: 'Bypass diode SBR40',   stock: 3, reorderAt: 5 },
  { sku: 'FUSE-25', name: '25 A fuse (RCO)',      stock: 2, reorderAt: 6 },
  { sku: 'TC-K',    name: 'Type-K thermocouple',  stock: 1, reorderAt: 4 },
];

// ---------------------------- helpers ---------------------------------

const statusDot = (s: Equipment['status']) =>
  s === 'ok' ? 'bg-emerald-500' : s === 'warn' ? 'bg-amber-500' : 'bg-rose-500';

const pri = (p: Ticket['priority']) =>
  p === 'P1' ? 'text-rose-400' : p === 'P2' ? 'text-amber-400' : 'text-gray-400';

// ----------------------------- cards ----------------------------------

function Card(props: { title: string; testid: string; children: React.ReactNode; href?: string }) {
  const body = (
    <section
      data-testid={props.testid}
      className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex flex-col gap-3 min-h-[180px]"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wide">
          {props.title}
        </h2>
        {props.href && (
          <span className="text-xs text-gray-500 group-hover:text-gray-300">open →</span>
        )}
      </header>
      <div className="text-gray-100">{props.children}</div>
    </section>
  );
  return props.href ? (
    <Link href={props.href} className="group block">
      {body}
    </Link>
  ) : (
    body
  );
}

function KPICard({ kpis }: { kpis: KPIs }) {
  const items: Array<[string, string]> = [
    ['Tests today',     String(kpis.testsToday)],
    ['Pass rate',       `${Math.round(kpis.passRate * 100)}%`],
    ['Mean run time',   `${kpis.meanRunTimeMin} min`],
    ['Fleet MTBF',      `${kpis.fleetMtbfHours.toLocaleString()} h`],
  ];
  return (
    <Card title="KPIs" testid="overview-card-kpis">
      <div className="grid grid-cols-2 gap-3">
        {items.map(([label, val]) => (
          <div key={label} className="bg-gray-950 rounded p-3 border border-gray-800">
            <div className="text-[10px] uppercase text-gray-500">{label}</div>
            <div className="text-2xl font-semibold text-white tabular-nums">{val}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function EquipmentCard({ items }: { items: Equipment[] }) {
  return (
    <Card title="Equipment health" testid="overview-card-equipment">
      <ul className="space-y-2 text-sm">
        {items.map(eq => (
          <li key={eq.id} className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${statusDot(eq.status)}`} />
              <span className="text-gray-200">{eq.name}</span>
            </span>
            <span className="text-xs text-gray-500">{eq.detail}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ScheduleCard({ runs }: { runs: ScheduledRun[] }) {
  const HOURS = 24;
  return (
    <Card title="Today's schedule" testid="overview-card-schedule">
      <div className="space-y-1.5">
        {runs.map(r => {
          const leftPct  = (r.startHour / HOURS) * 100;
          const widthPct = (r.durationHours / HOURS) * 100;
          return (
            <div key={r.id} className="flex items-center gap-2 text-xs">
              <span className="w-10 text-gray-400">{r.test}</span>
              <div className="flex-1 relative h-3 bg-gray-950 rounded border border-gray-800">
                <div
                  className="absolute top-0 bottom-0 bg-cyan-500/60 rounded"
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  title={`${r.startHour}:00 +${r.durationHours}h`}
                />
              </div>
              <span className="w-16 text-right text-gray-500 tabular-nums">
                {String(r.startHour).padStart(2, '0')}:00
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-2 text-[10px] text-gray-600 tabular-nums px-12">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
      </div>
    </Card>
  );
}

function TicketsCard({ tickets }: { tickets: Ticket[] }) {
  return (
    <Card title="Open tickets" testid="overview-card-tickets">
      <ul className="space-y-2 text-sm">
        {tickets.map(t => (
          <li key={t.id} className="flex items-center justify-between">
            <span className="truncate text-gray-200">
              <span className={`mr-2 font-semibold ${pri(t.priority)}`}>{t.priority}</span>
              {t.title}
            </span>
            <span className="text-xs text-gray-500 shrink-0 ml-2">
              {t.id} · {t.openedAgo}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SparesCard({ parts }: { parts: SparePart[] }) {
  return (
    <Card title="Spares — low stock" testid="overview-card-spares">
      <ul className="space-y-2 text-sm">
        {parts.map(p => (
          <li key={p.sku} className="flex items-center justify-between">
            <span className="text-gray-200">{p.name}</span>
            <span className="text-xs tabular-nums">
              <span className={p.stock < p.reorderAt ? 'text-rose-400' : 'text-gray-400'}>
                {p.stock}
              </span>
              <span className="text-gray-600"> / reorder @ {p.reorderAt}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AIChangeCard({ context }: { context: string }) {
  const [text, setText] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [cached, setCached] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ai/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context }),
        });
        const data = await res.json();
        if (cancelled) return;
        setText(data.response ?? '(no response)');
        setCached(Boolean(data.cached));
      } catch (err) {
        if (!cancelled) setText(`AI fetch failed: ${err}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [context]);

  return (
    <Card title="AI — what changed today" testid="overview-card-ai">
      {loading ? (
        <div className="text-sm text-gray-500">Asking Claude…</div>
      ) : (
        <pre className="text-sm text-gray-200 whitespace-pre-wrap font-sans leading-relaxed">
          {text}
        </pre>
      )}
      <div className="mt-2 text-[10px] uppercase tracking-wide text-gray-600">
        {cached ? 'cache hit' : 'fresh'} · /api/ai/ask
      </div>
    </Card>
  );
}

// ----------------------------- page -----------------------------------

export default function OverviewPage() {
  const aiContext = JSON.stringify({
    kpis: MOCK_KPIS,
    equipment: MOCK_EQUIPMENT,
    tickets: MOCK_TICKETS,
    parts: MOCK_PARTS,
  });

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100" data-testid="overview-root">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Agnipariksha — 360° Overview</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Fleet posture · schedule · service · spares
          </p>
        </div>
        <nav className="flex gap-3 text-xs">
          <Link href="/dashboard" className="text-gray-400 hover:text-white">
            Legacy dashboard →
          </Link>
        </nav>
      </header>

      <main className="p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <KPICard kpis={MOCK_KPIS} />
        <EquipmentCard items={MOCK_EQUIPMENT} />
        <ScheduleCard runs={MOCK_SCHEDULE} />
        <TicketsCard tickets={MOCK_TICKETS} />
        <SparesCard parts={MOCK_PARTS} />
        <AIChangeCard context={aiContext} />
      </main>

      <footer className="px-6 pb-6 text-[10px] text-gray-600 flex gap-4 flex-wrap">
        <span>flags:</span>
        <span>DB={String(flags.db)}</span>
        <span>RELIABILITY={String(flags.reliability)}</span>
        <span>SCHEDULER={String(flags.scheduler)}</span>
        <span>TICKETS={String(flags.tickets)}</span>
      </footer>
    </div>
  );
}
