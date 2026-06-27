'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type PsuSetpoints,
  type PsuState,
  validateSetpoint,
} from '@/features/opcua/psuClient';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export type OpcuaStatus = 'idle' | 'connected' | 'error';

interface Options {
  pollMs?: number;
  enabled?: boolean;
}

/**
 * Mirrors the PSU over OPC UA via the backend REST proxy
 * (`/api/opcua/psu`). Polls readings on an interval and exposes a guarded
 * `writeSetpoints` that POSTs the three client-writable Setpoint nodes.
 */
export function useOpcuaPsu({ pollMs = 1000, enabled = true }: Options = {}) {
  const [state, setState] = useState<PsuState | null>(null);
  const [status, setStatus] = useState<OpcuaStatus>('idle');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      if (timer.current) clearInterval(timer.current);
      return;
    }
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/opcua/psu`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: PsuState = await res.json();
        if (alive) {
          setState(data);
          setStatus('connected');
        }
      } catch {
        if (alive) setStatus('error');
      }
    };
    tick();
    timer.current = setInterval(tick, Math.max(200, pollMs));
    return () => {
      alive = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, [enabled, pollMs]);

  const writeSetpoints = useCallback(async (sp: PsuSetpoints): Promise<boolean> => {
    if (validateSetpoint(sp).length > 0) return false;
    try {
      const res = await fetch(`${API_BASE}/api/opcua/psu/setpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sp),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  return { state, status, writeSetpoints };
}
