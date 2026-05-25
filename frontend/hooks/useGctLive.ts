'use client';
import { useEffect, useRef, useState } from 'react';
import { useNotifications } from '@/components/notifications/NotificationsStore';

export interface GctReading {
  timestamp: number;
  resistance: number;
  passed: boolean;
  maxResistance: number;
  source: 'dmm_keysight' | 'sim';
  demo: boolean;
}

export type GctStatus = 'connecting' | 'connected' | 'disconnected' | 'demo';

interface Options {
  demoMode: boolean;
  maxResistance: number;
  intervalS?: number;
  /** When false, the hook idles and does not stream readings. */
  enabled?: boolean;
  /**
   * Short test label used in notification titles. Defaults to "GCT".
   * EB (Equipotential Bonding) reuses this hook with label "EB" — both are
   * DMM-only 4-wire resistance flows per IEC 61730-2 MST 13.
   */
  label?: string;
  /** Live WS sub-path. Defaults to the GCT endpoint. */
  wsPath?: string;
}

/**
 * Live GCT 4-wire resistance feed.
 *
 * In demo mode this hook produces a local simulated reading every 500 ms
 * so the UI behaves identically without a backend.
 *
 * In live mode it opens a WebSocket to ``/ws/gct/live``, which is backed
 * by the Keysight 34465A DMM. The ITECH PSU is **not** touched — GCT is
 * a DMM-only flow per IEC 61730-2 MST 13.
 */
export function useGctLive({
  demoMode,
  maxResistance,
  intervalS = 0.5,
  enabled = true,
  label = 'GCT',
  wsPath = '/ws/gct/live',
}: Options) {
  const [readings, setReadings] = useState<GctReading[]>([]);
  const [status, setStatus] = useState<GctStatus>(demoMode ? 'demo' : 'connecting');
  const [psuOff, setPsuOff] = useState<boolean | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const demoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { push } = useNotifications();

  useEffect(() => {
    if (!enabled) {
      setReadings([]);
      setStatus(demoMode ? 'demo' : 'disconnected');
      return;
    }

    if (demoMode) {
      setStatus('demo');
      setPsuOff(true);
      if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
      demoIntervalRef.current = setInterval(() => {
        const r = Math.max(0, 0.03 + (Math.random() - 0.5) * 0.012);
        setReadings(prev => {
          const next = [...prev, {
            timestamp: Date.now(),
            resistance: +r.toFixed(6),
            passed: r < maxResistance,
            maxResistance,
            source: 'sim' as const,
            demo: true,
          }];
          return next.length > 300 ? next.slice(-300) : next;
        });
      }, Math.max(100, intervalS * 1000));
      return () => {
        if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
      };
    }

    // Live mode — open a dedicated WS for the resistance feed
    const base = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/ws/telemetry';
    // Derive the live URL from the configured base, preserving host.
    let gctUrl = base.replace(/\/ws\/[^?]*/, wsPath);
    if (gctUrl === base) gctUrl = base.replace(/\/$/, '') + wsPath;
    const qs = new URLSearchParams({
      max_resistance: String(maxResistance),
      interval: String(intervalS),
    });
    const url = `${gctUrl}?${qs.toString()}`;

    setStatus('connecting');
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      push({ severity: 'success', source: 'websocket', title: `${label} live connected`, message: url });
    };
    ws.onclose = () => {
      setStatus('disconnected');
      push({ severity: 'warning', source: 'websocket', title: `${label} live disconnected`, message: url });
    };
    ws.onerror = () => {
      setStatus('disconnected');
      push({ severity: 'error', source: 'websocket', title: `${label} WebSocket error`, message: url });
    };
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data?.type === 'gct_status') {
          if (typeof data.psu_output_off === 'boolean') setPsuOff(data.psu_output_off);
          return;
        }
        if (data?.type === 'error') {
          push({
            severity: 'error', source: 'scpi',
            title: `${label} error`, message: String(data.reason ?? data.error ?? 'unknown'),
          });
          return;
        }
        if (data?.type === 'gct_reading'
          && typeof data.resistance === 'number'
          && typeof data.pass === 'boolean'
        ) {
          const source: GctReading['source'] = data.source === 'dmm_keysight'
            ? 'dmm_keysight' : 'sim';
          const reading: GctReading = {
            timestamp: typeof data.ts === 'number' ? data.ts : Date.now(),
            resistance: data.resistance,
            passed: data.pass,
            maxResistance: typeof data.max_resistance === 'number' ? data.max_resistance : maxResistance,
            source,
            demo: !!data.demo,
          };
          setReadings(prev => {
            const next = [...prev, reading];
            return next.length > 300 ? next.slice(-300) : next;
          });
        }
      } catch {
        /* malformed frames ignored */
      }
    };

    return () => {
      try { ws.send(JSON.stringify({ type: 'stop' })); } catch { /* socket may be closing */ }
      ws.close();
    };
  }, [demoMode, enabled, intervalS, maxResistance, push, label, wsPath]);

  const latest = readings.length > 0 ? readings[readings.length - 1] : null;
  return { readings, latest, status, psuOff };
}
