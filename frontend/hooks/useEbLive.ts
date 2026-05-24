'use client';
import { useGctLive, type GctReading, type GctStatus } from './useGctLive';

export type EbReading = GctReading;
export type EbStatus = GctStatus;

interface Options {
  demoMode: boolean;
  maxResistance: number;
  intervalS?: number;
  enabled?: boolean;
}

/**
 * Live Equipotential Bonding 4-wire resistance feed.
 *
 * EB (IEC 61730-2 MST 13) is the same DMM-only, PSU-OFF measurement flow as
 * GCT — low-resistance bonding between exposed conductive parts and the
 * protective earthing terminal. Rather than duplicate the streaming /
 * demo-simulation logic, this is a thin wrapper around {@link useGctLive}
 * with an EB-specific notification label and WS sub-path.
 */
export function useEbLive(opts: Options) {
  return useGctLive({ ...opts, label: 'EB', wsPath: '/ws/eb/live' });
}
