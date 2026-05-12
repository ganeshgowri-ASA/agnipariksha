'use client';

import { useEffect, useState } from 'react';
import { Ticket as TicketIcon, X } from 'lucide-react';
import { createTicketApi } from '@/hooks/useTickets';
import type {
  TicketType,
  TicketPriority,
  TicketLinks,
} from '@/lib/tickets-types';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (id: string) => void;
  defaults?: {
    type?: TicketType;
    title?: string;
    description?: string;
    priority?: TicketPriority;
    source?: string;
    links?: TicketLinks;
    tags?: string[];
  };
}

export default function RaiseTicketDialog({ open, onClose, onCreated, defaults }: Props) {
  const [type, setType] = useState<TicketType>(defaults?.type ?? 'complaint');
  const [title, setTitle] = useState(defaults?.title ?? '');
  const [description, setDescription] = useState(defaults?.description ?? '');
  const [priority, setPriority] = useState<TicketPriority>(defaults?.priority ?? 'normal');
  const [assignee, setAssignee] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setType(defaults?.type ?? 'complaint');
    setTitle(defaults?.title ?? '');
    setDescription(defaults?.description ?? '');
    setPriority(defaults?.priority ?? 'normal');
    setAssignee('');
    setError(null);
  }, [open, defaults?.type, defaults?.title, defaults?.description, defaults?.priority]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async () => {
    setError(null);
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    setSubmitting(true);
    try {
      const t = await createTicketApi({
        type,
        title: title.trim(),
        description,
        priority,
        assignee: assignee.trim() || undefined,
        source: defaults?.source ?? 'manual',
        links: defaults?.links,
        tags: defaults?.tags,
      });
      onCreated?.(t.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create ticket');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50" data-testid="raise-ticket-dialog">
      <button
        type="button" aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-black/60" />
      <div
        role="dialog" aria-label="Raise Ticket"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-gray-950 border border-gray-800 rounded-lg shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <TicketIcon className="w-4 h-4 text-orange-400" />
            <h2 className="text-sm font-bold text-white">Raise Ticket</h2>
          </div>
          <button
            type="button" onClick={onClose} aria-label="Close"
            className="text-gray-400 hover:text-white p-1 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 text-sm">
          <div className="flex gap-2">
            {(['complaint', 'maintenance'] as TicketType[]).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setType(opt)}
                data-testid={`ticket-type-${opt}`}
                className={`px-3 py-1 rounded text-xs font-semibold border ${
                  type === opt
                    ? 'bg-orange-600 border-orange-500 text-white'
                    : 'bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800'
                }`}
              >
                {opt === 'complaint' ? 'Complaint' : 'Maintenance'}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Title</label>
            <input
              data-testid="ticket-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
              placeholder="Short summary"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Description</label>
            <textarea
              data-testid="ticket-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white font-mono"
              placeholder="Details, steps to reproduce, error text…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Priority</label>
              <select
                data-testid="ticket-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Assignee (optional)</label>
              <input
                data-testid="ticket-assignee"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
                placeholder="email or username"
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-300" data-testid="ticket-error">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-800">
          <button
            type="button" onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-300 hover:text-white">
            Cancel
          </button>
          <button
            type="button"
            data-testid="ticket-submit"
            onClick={submit}
            disabled={submitting}
            className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded text-xs font-semibold text-white"
          >
            {submitting ? 'Creating…' : 'Create Ticket'}
          </button>
        </div>
      </div>
    </div>
  );
}
