import AppShell from '@/components/AppShell';
import OpcuaPsuPanel from '@/components/OpcuaPsuPanel';

// DC Power Supply surface — mirrors the PSU over the backend OPC UA REST
// proxy (GET/POST /api/opcua/psu). The panel is a client component; this
// route is a thin server wrapper that drops it into the shared AppShell.
export default function PsuPage() {
  return (
    <AppShell
      title="DC Power Supply"
      subtitle="OPC UA mirror · live telemetry + setpoints"
    >
      <div className="p-6 max-w-3xl" data-testid="psu-page">
        <OpcuaPsuPanel />
        <p className="mt-4 text-[11px] text-muted">
          Live readings poll <code>GET /api/opcua/psu</code>; the Write button
          posts to <code>/api/opcua/psu/setpoints</code>. Start the backend
          with <code>DEMO_MODE=true</code> — LIVE energization stays gated
          server-side.
        </p>
      </div>
    </AppShell>
  );
}
