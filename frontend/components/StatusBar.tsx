'use client';

import type { TestSession } from '@/types/test-session';

export default function StatusBar({ wsStatus, demoMode, sessions }: {
  wsStatus: string;
  demoMode: boolean;
  sessions: Record<string, TestSession | null>;
}) {
  const running = Object.entries(sessions).filter(([, s]) => s?.status === 'running');
  const now = new Date().toLocaleTimeString();

  return (
    <footer className="bg-gray-900 border-t border-gray-700 px-4 py-1.5 flex items-center justify-between text-xs text-gray-500">
      <div className="flex items-center gap-4">
        <span className={wsStatus === 'connected' || wsStatus === 'demo' ? 'text-green-400' : 'text-red-400'}>
          ● {demoMode ? 'Demo Mode' : wsStatus}
        </span>
        <span>ITECH PV6000 @ 192.168.200.100:30000</span>
      </div>
      <div className="flex items-center gap-4">
        {running.length > 0 && (
          <span className="text-yellow-400">{running.length} test(s) active</span>
        )}
        <span>{now}</span>
        <span>Agnipariksha v1.0.0</span>
      </div>
    </footer>
  );
}
