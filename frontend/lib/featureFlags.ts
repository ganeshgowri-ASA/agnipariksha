/**
 * Feature flags for V2 dark-launch.
 *
 * Each flag gates a V2 area independently of the legacy /dashboard tabs.
 * Flags are read from NEXT_PUBLIC_* env at build/runtime so they ship to
 * the browser. A flag that is unset defaults to OFF for "dark launched"
 * areas (DB / Reliability / Scheduler / Tickets) so existing behaviour
 * never changes when env is missing.
 *
 * Toggle examples (.env.local):
 *   NEXT_PUBLIC_FF_DB=1
 *   NEXT_PUBLIC_FF_RELIABILITY=1
 *   NEXT_PUBLIC_FF_SCHEDULER=1
 *   NEXT_PUBLIC_FF_TICKETS=1
 *   NEXT_PUBLIC_FF_OVERVIEW=1   # optional; defaults ON
 */

export type FlagKey =
  | 'FF_DB'
  | 'FF_RELIABILITY'
  | 'FF_SCHEDULER'
  | 'FF_TICKETS'
  | 'FF_OVERVIEW';

const truthy = (v: string | undefined): boolean =>
  v !== undefined && v !== '' && v !== '0' && v.toLowerCase() !== 'false';

// Statically reference each env var so Next.js inlines the value at build.
const RAW: Record<FlagKey, string | undefined> = {
  FF_DB:          process.env.NEXT_PUBLIC_FF_DB,
  FF_RELIABILITY: process.env.NEXT_PUBLIC_FF_RELIABILITY,
  FF_SCHEDULER:   process.env.NEXT_PUBLIC_FF_SCHEDULER,
  FF_TICKETS:     process.env.NEXT_PUBLIC_FF_TICKETS,
  FF_OVERVIEW:    process.env.NEXT_PUBLIC_FF_OVERVIEW,
};

// Overview is on by default; if the env var is set, it wins.
const DEFAULTS: Record<FlagKey, boolean> = {
  FF_DB:          false,
  FF_RELIABILITY: false,
  FF_SCHEDULER:   false,
  FF_TICKETS:     false,
  FF_OVERVIEW:    true,
};

export function isEnabled(flag: FlagKey): boolean {
  const raw = RAW[flag];
  if (raw === undefined) return DEFAULTS[flag];
  return truthy(raw);
}

export const flags = {
  db:          isEnabled('FF_DB'),
  reliability: isEnabled('FF_RELIABILITY'),
  scheduler:   isEnabled('FF_SCHEDULER'),
  tickets:     isEnabled('FF_TICKETS'),
  overview:    isEnabled('FF_OVERVIEW'),
} as const;
