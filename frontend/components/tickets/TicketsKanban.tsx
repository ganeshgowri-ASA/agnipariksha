'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Clock, Wrench, MessageSquareWarning } from 'lucide-react';
import {
  useTickets,
  transitionTicketApi,
} from '@/hooks/useTickets';
import {
  TICKET_STATES,
  TICKET_STATE_LABEL,
  TICKET_PRIORITY_LABEL,
  TICKET_TRANSITIONS,
  type Ticket,
  type TicketState,
  type TicketType,
  type TicketPriority,
} from '@/lib/tickets-types';

const STATE_COLOR: Record<TicketState, string> = {
  open: 'border-blue-700/60 bg-blue-900/20 text-blue-200',
  in_progress: 'border-yellow-700/60 bg-yellow-900/20 text-yellow-200',
  waiting_part: 'border-purple-700/60 bg-purple-900/20 text-purple-200',
  resolved: 'border-green-700/60 bg-green-900/20 text-green-200',
  closed: 'border-gray-700/60 bg-gray-900/40 text-gray-300',
};

const PRIORITY_COLOR: Record<TicketPriority, string> = {
  critical: 'bg-red-600 text-white',
  high: 'bg-orange-500 text-white',
  normal: 'bg-blue-600 text-white',
  low: 'bg-gray-600 text-white',
};

function formatDueIn(due_at: number, breached: boolean): string {
  const remaining = due_at - Date.now() / 1000;
  const abs = Math.abs(remaining);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  if (breached) return `Overdue ${h}h ${m}m`;
  if (h > 24) return `Due in ${Math.floor(h / 24)}d ${h % 24}h`;
  return `Due in ${h}h ${m}m`;
}

function TicketCard({
  t,
  onAdvance,
}: {
  t: Ticket;
  onAdvance: (id: string, to: TicketState) => void;
}) {
  const Icon = t.type === 'maintenance' ? Wrench : MessageSquareWarning;
  const next = TICKET_TRANSITIONS[t.state];
  return (
    <article
      data-testid="ticket-card"
      data-ticket-id={t.id}
      data-state={t.state}
      className="bg-gray-900 border border-gray-700 rounded p-2.5 space-y-2"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon className="w-3.5 h-3.5 text-orange-400 shrink-0" />
          <span className="font-mono text-[10px] text-gray-400">{t.id}</span>
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${PRIORITY_COLOR[t.priority]}`}>
          {TICKET_PRIORITY_LABEL[t.priority]}
        </span>
      </header>
      <p className="text-xs font-semibold text-white break-words" data-testid="ticket-title-text">
        {t.title}
      </p>
      {t.description && (
        <p className="text-[11px] text-gray-400 line-clamp-2">{t.description}</p>
      )}
      <div className="flex flex-wrap gap-1 text-[10px]">
        {t.source && (
          <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">{t.source}</span>
        )}
        {t.assignee && (
          <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">@{t.assignee}</span>
        )}
        {t.links?.test_run_id && (
          <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">
            run:{t.links.test_run_id}
          </span>
        )}
      </div>
      <div
        className={`flex items-center gap-1 text-[10px] ${
          t.sla_breached ? 'text-red-300' : 'text-gray-400'
        }`}
      >
        {t.sla_breached ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
        {formatDueIn(t.due_at, t.sla_breached)}
      </div>
      {next.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1 border-t border-gray-800">
          {next.map((to) => (
            <button
              key={to}
              type="button"
              data-testid={`ticket-advance-${to}`}
              onClick={() => onAdvance(t.id, to)}
              className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-200"
            >
              → {TICKET_STATE_LABEL[to]}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

export default function TicketsKanban() {
  const [typeFilter, setTypeFilter] = useState<TicketType | ''>('');
  const [search, setSearch] = useState('');
  const { tickets, loading, error, refresh } = useTickets({
    type: typeFilter || null,
    q: search.trim() || null,
    pollMs: 4000,
  });

  const columns = useMemo(() => {
    const cols: Record<TicketState, Ticket[]> = {
      open: [], in_progress: [], waiting_part: [], resolved: [], closed: [],
    };
    for (const t of tickets) cols[t.state].push(t);
    return cols;
  }, [tickets]);

  const advance = async (id: string, to: TicketState) => {
    try {
      await transitionTicketApi(id, to);
      await refresh();
    } catch (e) {
      console.error('transition failed', e);
    }
  };

  return (
    <div className="p-4 space-y-3" data-testid="tickets-kanban">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {(['', 'maintenance', 'complaint'] as const).map((opt) => (
            <button
              key={opt || 'all'}
              type="button"
              onClick={() => setTypeFilter(opt)}
              data-testid={`filter-${opt || 'all'}`}
              className={`px-2.5 py-1 rounded text-xs font-medium border ${
                typeFilter === opt
                  ? 'bg-orange-600 border-orange-500 text-white'
                  : 'bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800'
              }`}
            >
              {opt === '' ? 'All' : opt === 'maintenance' ? 'Maintenance' : 'Complaints'}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Search title or description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="filter-search"
          className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white w-64"
        />
        <span className="ml-auto text-[11px] text-gray-500" data-testid="ticket-count">
          {loading ? 'Loading…' : `${tickets.length} ticket${tickets.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {error && (
        <p className="text-xs text-red-300" data-testid="kanban-error">{error}</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        {TICKET_STATES.map((s) => (
          <section
            key={s}
            data-testid={`kanban-col-${s}`}
            className={`rounded border ${STATE_COLOR[s]} flex flex-col min-h-[200px]`}
          >
            <header className="px-3 py-2 border-b border-current/30 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider">
                {TICKET_STATE_LABEL[s]}
              </h3>
              <span className="text-[10px] opacity-80">{columns[s].length}</span>
            </header>
            <div className="p-2 space-y-2 flex-1">
              {columns[s].length === 0 ? (
                <p className="text-[11px] opacity-60 text-center py-6">No tickets.</p>
              ) : (
                columns[s].map((t) => (
                  <TicketCard key={t.id} t={t} onAdvance={advance} />
                ))
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
