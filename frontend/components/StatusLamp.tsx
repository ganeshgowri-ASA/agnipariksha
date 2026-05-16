'use client';

export type LampState = 'green' | 'yellow' | 'red' | 'gray';

const STATE_CLS: Record<LampState, string> = {
  green:  'bg-emerald-500 shadow-emerald-500/50',
  yellow: 'bg-amber-400 shadow-amber-400/50',
  red:    'bg-rose-500 shadow-rose-500/50 animate-pulse',
  gray:   'bg-gray-600 shadow-none',
};

const STATE_LABEL: Record<LampState, string> = {
  green:  'READY',
  yellow: 'RESOLVE',
  red:    'STOP',
  gray:   'UNKNOWN',
};

const STATE_RING: Record<LampState, string> = {
  green:  'ring-emerald-500/30',
  yellow: 'ring-amber-400/30',
  red:    'ring-rose-500/30',
  gray:   'ring-gray-700',
};

export interface StatusLampProps {
  label: string;
  state: LampState;
  detail?: string;
  /**
   * Optional onClick — wired up by StatusTower → BasicCheck when a lamp
   * has a help/troubleshooting target.
   */
  onClick?: () => void;
}

export default function StatusLamp({ label, state, detail, onClick }: StatusLampProps) {
  const interactive = Boolean(onClick);
  const body = (
    <div
      className={`flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-950/70 px-3 py-2.5 ring-1 ${STATE_RING[state]} ${
        interactive ? 'cursor-pointer hover:bg-gray-900 transition-colors' : ''
      }`}
      data-testid={`status-lamp-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
      data-state={state}
    >
      <span
        aria-hidden
        className={`w-3.5 h-3.5 rounded-full shadow-md ${STATE_CLS[state]}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-200">{label}</span>
          <span
            className={`text-[10px] font-bold uppercase tracking-wider ${
              state === 'green'  ? 'text-emerald-400'
              : state === 'yellow' ? 'text-amber-400'
              : state === 'red'  ? 'text-rose-400'
              :                    'text-gray-500'
            }`}
          >
            {STATE_LABEL[state]}
          </span>
        </div>
        {detail && (
          <div className="text-[11px] text-gray-400 truncate" title={detail}>
            {detail}
          </div>
        )}
      </div>
    </div>
  );

  if (interactive) {
    return (
      <button type="button" onClick={onClick} className="block w-full text-left">
        {body}
      </button>
    );
  }
  return body;
}
