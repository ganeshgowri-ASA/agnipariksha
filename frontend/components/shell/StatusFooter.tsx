'use client';

import { cn } from '@/lib/utils';
import type { WsStatus } from '@/hooks/useWebSocket';

interface StatusFooterProps {
  wsStatus: WsStatus;
  demoMode: boolean;
  bufferDepth: number;
  buildTag?: string;
}

export function StatusFooter({ wsStatus, demoMode, bufferDepth, buildTag = 'v0.1.0-shell' }: StatusFooterProps) {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-steel-700 bg-panel-raised px-4 py-1.5 font-mono text-[11px] text-steel-400">
      <div className="flex items-center gap-4">
        <span>
          mode:{' '}
          <span className={cn(demoMode ? 'text-signal-info' : 'text-signal-ok')}>{demoMode ? 'demo' : 'live'}</span>
        </span>
        <span>
          ws: <span className="text-steel-200">{wsStatus}</span>
        </span>
        <span>
          buffer: <span className="text-steel-200">{bufferDepth.toString().padStart(3, '0')}</span>
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span>build {buildTag}</span>
        <span className="text-steel-500">© Shreshtata Power Supplies</span>
      </div>
    </footer>
  );
}

export default StatusFooter;
