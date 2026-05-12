'use client';

import { useEffect, useState } from 'react';
import { Bell, Copy, Trash2, X, AlertTriangle, AlertCircle, Info, CheckCircle2, Ticket as TicketIcon } from 'lucide-react';
import { useNotifications, type Notification, type NotificationSeverity } from './NotificationsStore';
import RaiseTicketDialog from '@/components/tickets/RaiseTicketDialog';

const SEVERITY_META: Record<NotificationSeverity, { label: string; cls: string; icon: typeof Info }> = {
  info:    { label: 'Info',    cls: 'text-blue-300 border-blue-700/40 bg-blue-900/20',    icon: Info },
  warning: { label: 'Warning', cls: 'text-yellow-300 border-yellow-700/40 bg-yellow-900/20', icon: AlertTriangle },
  error:   { label: 'Error',   cls: 'text-red-300 border-red-700/40 bg-red-900/20',       icon: AlertCircle },
  success: { label: 'Success', cls: 'text-green-300 border-green-700/40 bg-green-900/20', icon: CheckCircle2 },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function copyToClipboard(text: string) {
  if (navigator?.clipboard?.writeText) {
    void navigator.clipboard.writeText(text);
  }
}

function NotificationRow({ n, onRemove }: { n: Notification; onRemove: (id: string) => void }) {
  const meta = SEVERITY_META[n.severity];
  const Icon = meta.icon;
  const payload = `[${formatTime(n.timestamp)}] [${n.severity.toUpperCase()}] [${n.source}] ${n.title} — ${n.message}`;
  const [raiseOpen, setRaiseOpen] = useState(false);
  const canRaise = n.severity === 'error' || n.severity === 'warning';
  return (
    <li className={`border ${meta.cls} rounded px-3 py-2 text-xs font-mono`} data-testid={`notif-${n.severity}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider opacity-80">
              <span>{n.source}</span>
              <span>·</span>
              <span>{formatTime(n.timestamp)}</span>
            </div>
            <p className="font-semibold mt-0.5 break-words">{n.title}</p>
            <p className="opacity-90 break-words">{n.message}</p>
            {canRaise && (
              <button
                type="button"
                data-testid="raise-ticket-from-toast"
                onClick={() => setRaiseOpen(true)}
                className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded border border-orange-600/60 bg-orange-900/30 text-orange-200 hover:bg-orange-900/50 text-[10px] font-semibold"
              >
                <TicketIcon className="w-3 h-3" /> Raise ticket
              </button>
            )}
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            type="button" aria-label="Copy" title="Copy"
            onClick={() => copyToClipboard(payload)}
            className="text-gray-400 hover:text-white p-1 rounded">
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            type="button" aria-label="Dismiss" title="Dismiss"
            onClick={() => onRemove(n.id)}
            className="text-gray-400 hover:text-white p-1 rounded">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <RaiseTicketDialog
        open={raiseOpen}
        onClose={() => setRaiseOpen(false)}
        defaults={{
          type: 'complaint',
          title: n.title,
          description: `${n.message}\n\n— source: ${n.source} @ ${formatTime(n.timestamp)}`,
          priority: n.severity === 'error' ? 'high' : 'normal',
          source: `error_toast:${n.source}`,
          links: n.testId ? { test_run_id: n.testId } : {},
          tags: [n.source, n.severity],
        }}
      />
    </li>
  );
}

export function NotificationsBell() {
  const { unreadCount } = useNotifications();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button" aria-label="Notifications"
        onClick={() => setOpen(true)}
        className="relative p-1.5 rounded hover:bg-gray-800 text-gray-300">
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] leading-4 text-center rounded-full font-bold">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      <NotificationsDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function NotificationsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { items, markAllRead, clear, remove } = useNotifications();

  useEffect(() => {
    if (open) markAllRead();
  }, [open, markAllRead]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button" aria-label="Close notifications"
        onClick={onClose}
        className="absolute inset-0 bg-black/50" />
      <aside
        role="dialog" aria-label="Notifications"
        className="absolute top-0 right-0 h-full w-full max-w-md bg-gray-950 border-l border-gray-800 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-orange-400" />
            <h2 className="text-sm font-bold text-white">Notifications</h2>
            <span className="text-xs text-gray-500">({items.length})</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button" onClick={clear} disabled={items.length === 0}
              className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded disabled:opacity-30 inline-flex items-center gap-1">
              <Trash2 className="w-3.5 h-3.5" /> Clear
            </button>
            <button
              type="button" onClick={onClose} aria-label="Close"
              className="text-gray-400 hover:text-white p-1 rounded">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {items.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-12">No notifications.</p>
          ) : (
            <ul className="space-y-2">
              {items.map(n => (
                <NotificationRow key={n.id} n={n} onRemove={remove} />
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
