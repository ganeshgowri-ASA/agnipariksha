'use client';

import Link from 'next/link';
import { ArrowLeft, Ticket as TicketIcon } from 'lucide-react';
import TicketsKanban from '@/components/tickets/TicketsKanban';
import RaiseTicketButton from '@/components/tickets/RaiseTicketButton';
import { NotificationsProvider } from '@/components/notifications/NotificationsStore';
import { useAssignmentNotifications } from '@/lib/webpush';

function AssignmentBridge() {
  useAssignmentNotifications(null, 8000);
  return null;
}

export default function TicketsPage() {
  return (
    <NotificationsProvider>
      <AssignmentBridge />
      <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
        <header className="bg-gradient-to-r from-gray-950 via-gray-900 to-gray-950 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-gray-400 hover:text-white inline-flex items-center gap-1.5 text-xs"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Dashboard
            </Link>
            <div className="w-px h-5 bg-gray-700" />
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
                <TicketIcon className="w-4 h-4 text-white" />
              </div>
              <div className="leading-tight">
                <h1 className="text-sm font-bold text-white">Tickets</h1>
                <p className="text-[10px] uppercase tracking-[0.18em] text-gray-400">
                  Maintenance · Complaints
                </p>
              </div>
            </div>
          </div>
          <RaiseTicketButton
            size="md"
            defaults={{ source: 'tickets_page' }}
          />
        </header>
        <main className="flex-1 overflow-auto">
          <TicketsKanban />
        </main>
      </div>
    </NotificationsProvider>
  );
}
