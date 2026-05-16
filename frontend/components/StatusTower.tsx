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
  // The grid tracks the number of lamps so 4/5/6 all render cleanly. The
  // 6-lamp layout (3 devices + backend/frontend/cloud-ai) is the canonical
  // one after the /api/scpi/smoke wiring landed.
  const n = lamps.length;
  const cols =
    n >= 6 ? 'lg:grid-cols-6 md:grid-cols-3' :
    n === 5 ? 'lg:grid-cols-5 md:grid-cols-3' :
              'lg:grid-cols-4 md:grid-cols-2';
  return (
    <section
      data-testid="status-tower"
      data-lamp-count={n}
      aria-label="System readiness lamps"
      className={`grid grid-cols-1 sm:grid-cols-2 ${cols} gap-3`}
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
 * Canonical lamp keys after /api/scpi/smoke wiring:
 * 3 devices (scpi/chamber/dmm) + 3 stack lamps (backend/frontend/cloud-ai).
 * Older 4-lamp callers still work — the tower is just a dumb renderer.
 */
export const DEFAULT_TOWER_KEYS = [
  'scpi', 'chamber', 'dmm', 'backend', 'frontend', 'cloud-ai',
] as const;
export type DefaultTowerKey = typeof DEFAULT_TOWER_KEYS[number];
