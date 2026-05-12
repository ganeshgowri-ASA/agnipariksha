'use client';

import { useState } from 'react';
import { Ticket as TicketIcon } from 'lucide-react';
import RaiseTicketDialog from './RaiseTicketDialog';
import type { TicketPriority, TicketLinks, TicketType } from '@/lib/tickets-types';
import { useNotifications } from '@/components/notifications/NotificationsStore';

interface Props {
  defaults?: {
    type?: TicketType;
    title?: string;
    description?: string;
    priority?: TicketPriority;
    source?: string;
    links?: TicketLinks;
    tags?: string[];
  };
  label?: string;
  className?: string;
  size?: 'sm' | 'md';
}

export default function RaiseTicketButton({
  defaults, label = 'Raise ticket', className = '', size = 'sm',
}: Props) {
  const [open, setOpen] = useState(false);
  const { push } = useNotifications();

  return (
    <>
      <button
        type="button"
        data-testid="raise-ticket-btn"
        onClick={() => setOpen(true)}
        className={
          className ||
          `inline-flex items-center gap-1.5 ${size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} rounded border border-orange-600/60 text-orange-200 bg-orange-900/30 hover:bg-orange-900/50 font-semibold`
        }
      >
        <TicketIcon className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
        {label}
      </button>
      <RaiseTicketDialog
        open={open}
        onClose={() => setOpen(false)}
        defaults={defaults}
        onCreated={(id) =>
          push({
            severity: 'success',
            source: 'user',
            title: 'Ticket created',
            message: `Ticket ${id} has been raised.`,
          })
        }
      />
    </>
  );
}
