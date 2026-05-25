'use client';

import { useState } from 'react';
import EquipotentialBondingTab from '@/components/tabs/EquipotentialBondingTab';
import { NotificationsProvider } from '@/components/notifications/NotificationsStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import type { TestSession } from '@/types/test-session';

function EquipotentialBondingPage() {
  const [session, setSession] = useState<TestSession | null>(null);
  const [demoMode] = useState(true);
  const { readings, sendCommand } = useWebSocket(demoMode);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <EquipotentialBondingTab
        readings={readings}
        session={session}
        onSessionUpdate={setSession}
        sendCommand={sendCommand}
        demoMode={demoMode}
      />
    </div>
  );
}

export default function Page() {
  return (
    <NotificationsProvider>
      <EquipotentialBondingPage />
    </NotificationsProvider>
  );
}
