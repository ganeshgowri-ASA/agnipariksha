/**
 * Server-side in-memory fallback store. Used only when the FastAPI backend
 * is unreachable (Playwright E2E, demo-only sessions). Mirrors the contract
 * of backend/tickets.py.
 */
import {
  type Ticket,
  type TicketCreate,
  type TicketState,
  type TicketPriority,
  SLA_HOURS,
  TICKET_TRANSITIONS,
} from './tickets-types';

interface AssignmentNotification {
  id: string;
  ts: number;
  kind: 'assignment';
  ticket_id: string;
  title: string;
  assignee: string;
  by: string | null;
  channels: string[];
}

const items = new Map<string, Ticket>();
const notifications: AssignmentNotification[] = [];

function rid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

function isBreached(t: Ticket): boolean {
  if (t.state === 'resolved' || t.state === 'closed') return false;
  return Date.now() / 1000 > t.due_at;
}

function refreshBreach(t: Ticket): Ticket {
  return { ...t, sla_breached: isBreached(t) };
}

function emitAssignment(t: Ticket, by: string | null): void {
  notifications.push({
    id: rid('ntf'),
    ts: Date.now() / 1000,
    kind: 'assignment',
    ticket_id: t.id,
    title: t.title,
    assignee: t.assignee as string,
    by,
    channels: ['inapp'],
  });
}

export function listTickets(filter: {
  type?: string | null;
  state?: string | null;
  assignee?: string | null;
  q?: string | null;
}): Ticket[] {
  let out = Array.from(items.values());
  if (filter.type) out = out.filter((t) => t.type === filter.type);
  if (filter.state) out = out.filter((t) => t.state === filter.state);
  if (filter.assignee) out = out.filter((t) => t.assignee === filter.assignee);
  if (filter.q) {
    const q = filter.q.toLowerCase();
    out = out.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
    );
  }
  out.sort((a, b) => b.created_at - a.created_at);
  return out.map(refreshBreach);
}

export function createTicket(payload: TicketCreate): Ticket {
  const title = (payload.title || '').trim();
  if (!title) throw new Error('title must not be blank');
  const priority: TicketPriority = payload.priority ?? 'normal';
  const now = Date.now() / 1000;
  const t: Ticket = {
    id: rid('TKT'),
    type: payload.type,
    title,
    description: payload.description ?? '',
    state: 'open',
    priority,
    assignee: payload.assignee ?? null,
    reporter: payload.reporter ?? null,
    links: payload.links ?? {},
    tags: payload.tags ?? [],
    source: payload.source ?? null,
    attachments: [],
    history: [{ ts: now, event: 'created', to: 'open', by: payload.reporter ?? null }],
    created_at: now,
    updated_at: now,
    due_at: now + SLA_HOURS[priority] * 3600,
    sla_breached: false,
  };
  items.set(t.id, t);
  if (t.assignee) emitAssignment(t, payload.reporter ?? null);
  return refreshBreach(t);
}

export function getTicket(id: string): Ticket | null {
  const t = items.get(id);
  return t ? refreshBreach(t) : null;
}

export function patchTicket(
  id: string,
  patch: Partial<{
    title: string;
    description: string;
    priority: TicketPriority;
    assignee: string | null;
    state: TicketState;
    tags: string[];
  }>,
): Ticket | null {
  const t = items.get(id);
  if (!t) return null;
  if (patch.title !== undefined) t.title = patch.title.trim();
  if (patch.description !== undefined) t.description = patch.description;
  if (patch.tags !== undefined) t.tags = patch.tags;
  if (patch.priority !== undefined && patch.priority !== t.priority) {
    t.priority = patch.priority;
    t.due_at = t.created_at + SLA_HOURS[t.priority] * 3600;
  }
  if (patch.assignee !== undefined && patch.assignee !== t.assignee) {
    t.assignee = patch.assignee || null;
    if (t.assignee) emitAssignment(t, null);
  }
  if (patch.state !== undefined && patch.state !== t.state) {
    if (!TICKET_TRANSITIONS[t.state].includes(patch.state)) {
      throw new Error(`cannot transition ${t.state} -> ${patch.state}`);
    }
    t.state = patch.state;
  }
  t.updated_at = Date.now() / 1000;
  return refreshBreach(t);
}

export function transitionTicket(
  id: string,
  to: TicketState,
  note?: string,
): Ticket | null {
  const t = items.get(id);
  if (!t) return null;
  if (to === t.state) return refreshBreach(t);
  if (!TICKET_TRANSITIONS[t.state].includes(to)) {
    throw new Error(`cannot transition ${t.state} -> ${to}`);
  }
  const prev = t.state;
  t.state = to;
  t.updated_at = Date.now() / 1000;
  t.history.push({ ts: t.updated_at, event: 'transition', from: prev, to, note });
  return refreshBreach(t);
}

export function listNotifications(): AssignmentNotification[] {
  return [...notifications];
}

export function resetStore(): void {
  items.clear();
  notifications.length = 0;
}
