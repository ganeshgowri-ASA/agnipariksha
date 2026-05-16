'use client';

import { useEffect, useState } from 'react';
import type { TestSession } from '@/types/test-session';

const PLACEHOLDER_TIME = '—:—:—';

function formatNow(): string {
  // 12h clock with hour/minute/second; matches the legacy display but is
  // computed client-side so SSR + first client render agree on the
  // placeholder string (no hydration mismatch on AM/PM or locale drift).
  return new Date().toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

export default function StatusBar({ wsStatus, demoMode, sessions }: {
  wsStatus: string;
  demoMode: boolean;
  sessions: Record<string, TestSession | null>;
}) {
  // Hydration-safe clock: server renders the placeholder; the real time
  // populates after mount. suppressHydrationWarning on the time element
  // covers the one-render gap between the placeholder and the first tick.
  const [now, setNow] = useState<string>(PLACEHOLDER_TIME);

  useEffect(() => {
    setNow(formatNow());
    const timer = window.setInterval(() => setNow(formatNow()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const running = Object.entries(sessions).filter(([, s]) => s?.status === 'running');

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
        <span suppressHydrationWarning>{now}</span>
        <span>Agnipariksha v1.0.0</span>
      </div>
    </footer>
  );
}
