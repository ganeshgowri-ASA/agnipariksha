'use client';

import AppShell from '@/components/AppShell';
import InvertedIRTab from '@/components/tabs/InvertedIRTab';
import { NotificationsProvider } from '@/components/notifications/NotificationsStore';

// Standalone entry for the Inverted IR (forward-bias IR thermography) tab.
// DEMO-only: synthetic thermograms, no backend WebSocket required.
export default function IIRPage() {
  return (
    <AppShell title="Inverted IR" subtitle="Forward-bias IR thermography · DEMO">
      <div className="h-[calc(100vh-7rem)]" data-testid="iir-root">
        <NotificationsProvider>
          <InvertedIRTab
            readings={[]}
            session={null}
            onSessionUpdate={() => {}}
            sendCommand={() => {}}
            demoMode
          />
        </NotificationsProvider>
      </div>
    </AppShell>
  );
}
