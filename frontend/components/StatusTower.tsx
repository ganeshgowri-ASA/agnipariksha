'use client';

import StatusLamp, { type LampState } from './StatusLamp';

/**
 * One readiness lamp per system in the Basic Check view.
 *
 * Semantics (per the operator UX spec):
 *   green  = ready → operator may proceed
 *   yellow = resolve via Help / Troubleshooting / AI-Q&A
 *   red    = stop — blocked
 *   gray   = unknown / not checked yet
 *
 * The tower itself is dumb — it just renders lamps in a row. Wiring of
 * the four lamps to live conditions (backend health, SCPI transport,
 * websocket, AI availability) lives in ThermalCyclingBasicCheck.
 */
export interface StatusTowerLamp {
  key: string;
  label: string;
  state: LampState;
  detail?: string;
  onClick?: () => void;
}

export interface StatusTowerProps {
  lamps: StatusTowerLamp[];
}

export default function StatusTower({ lamps }: StatusTowerProps) {
  return (
    <section
      data-testid="status-tower"
      aria-label="System readiness lamps"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
    >
      {lamps.map(l => (
        <StatusLamp
          key={l.key}
          label={l.label}
          state={l.state}
          detail={l.detail}
          onClick={l.onClick}
        />
      ))}
    </section>
  );
}

/**
 * Convenience: the 4 canonical lamps the operator UX spec requires.
 * Callers fill in state + detail at runtime.
 */
export const DEFAULT_TOWER_KEYS = ['power-supply', 'backend', 'frontend', 'cloud-ai'] as const;
export type DefaultTowerKey = typeof DEFAULT_TOWER_KEYS[number];
