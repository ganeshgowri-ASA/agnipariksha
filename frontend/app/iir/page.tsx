'use client';

import AppShell from '@/components/AppShell';
import InvertedIRTab from '@/components/tabs/InvertedIRTab';

// Standalone entry for the Inverted IR (forward-bias IR thermography) tab.
// DEMO-only: synthetic thermograms, no backend WebSocket required.
export default function IIRPage() {
  return (
    <AppShell title="Inverted IR" subtitle="Forward-bias IR thermography · DEMO">
      <div className="h-[calc(100vh-7rem)]" data-testid="iir-root">
        <InvertedIRTab
          readings={[]}
          session={null}
          onSessionUpdate={() => {}}
          sendCommand={() => {}}
          demoMode
        />
      </div>
    </AppShell>
  );
}
