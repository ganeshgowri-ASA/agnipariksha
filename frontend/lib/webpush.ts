/**
 * Best-effort browser-side helper: when an assignment notification is
 * received from the backend, surface it as a Web Notification (when the
 * page is hidden) so the assignee sees it without keeping /tickets focused.
 *
 * Email delivery is handled server-side by the backend (channel:"email"
 * is emitted in the assignment record); this module only owns the
 * web-push half of the contract.
 */
'use client';

import { useEffect, useRef } from 'react';

interface AssignmentNotification {
  id: string;
  ts: number;
  kind: 'assignment';
  ticket_id: string;
  title: string;
  assignee: string;
  channels: string[];
}

export function useAssignmentNotifications(meAssignee: string | null, pollMs = 8000): void {
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      // Don't auto-prompt; users opt in via UI. Permission can be
      // requested separately.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch('/api/tickets/notifications', { cache: 'no-store' });
        if (!r.ok) return;
        const { items } = (await r.json()) as { items: AssignmentNotification[] };
        for (const it of items) {
          if (seen.current.has(it.id)) continue;
          seen.current.add(it.id);
          if (!it.channels.includes('webpush')) continue;
          if (meAssignee && it.assignee !== meAssignee) continue;
          if (typeof window === 'undefined' || !('Notification' in window)) continue;
          if (Notification.permission === 'granted') {
            new Notification(`Ticket assigned: ${it.ticket_id}`, {
              body: it.title,
              tag: it.ticket_id,
            });
          }
        }
      } catch {
        /* ignore */
      }
      if (!cancelled) setTimeout(tick, pollMs);
    };
    void tick();
    return () => { cancelled = true; };
  }, [meAssignee, pollMs]);
}

export async function requestPushPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  return await Notification.requestPermission();
}
