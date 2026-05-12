'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  Ticket,
  TicketCreate,
  TicketState,
} from '@/lib/tickets-types';

interface UseTicketsOptions {
  type?: 'maintenance' | 'complaint' | null;
  state?: TicketState | null;
  assignee?: string | null;
  q?: string | null;
  pollMs?: number;
}

export function useTickets(opts: UseTicketsOptions = {}) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const params = new URLSearchParams();
    if (opts.type) params.set('type', opts.type);
    if (opts.state) params.set('state', opts.state);
    if (opts.assignee) params.set('assignee', opts.assignee);
    if (opts.q) params.set('q', opts.q);
    try {
      const r = await fetch(`/api/tickets${params.toString() ? `?${params}` : ''}`, {
        cache: 'no-store',
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as Ticket[];
      setTickets(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [opts.type, opts.state, opts.assignee, opts.q]);

  useEffect(() => {
    void refresh();
    if (!opts.pollMs) return;
    const t = setInterval(refresh, opts.pollMs);
    return () => clearInterval(t);
  }, [refresh, opts.pollMs]);

  return { tickets, loading, error, refresh };
}

export async function createTicketApi(payload: TicketCreate): Promise<Ticket> {
  const r = await fetch('/api/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const detail = await r.text();
    throw new Error(`Failed to create ticket: ${r.status} ${detail}`);
  }
  return (await r.json()) as Ticket;
}

export async function transitionTicketApi(
  id: string,
  to: TicketState,
  note?: string,
): Promise<Ticket> {
  const r = await fetch(`/api/tickets/${encodeURIComponent(id)}/transition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, note }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as Ticket;
}

export async function patchTicketApi(
  id: string,
  patch: Record<string, unknown>,
): Promise<Ticket> {
  const r = await fetch(`/api/tickets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as Ticket;
}
