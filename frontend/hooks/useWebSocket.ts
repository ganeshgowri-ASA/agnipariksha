'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'demo';

export interface LiveReading {
  timestamp: number;
  voltage: number;
  current: number;
  power: number;
  temperature?: number;
  channel?: string;
}

export interface UseWebSocketOptions {
  url?: string;
  demoMode?: boolean;
  bufferSize?: number;
  demoIntervalMs?: number;
  maxReconnectMs?: number;
}

const DEFAULT_BUFFER = 600;
const DEFAULT_DEMO_INTERVAL = 500;
const DEFAULT_MAX_BACKOFF = 15_000;

// Synthetic stream used when DEMO_MODE is on or the WS endpoint is offline.
// Produces a believable PV-style waveform with light noise on V/I/T.
function synthesise(t: number): LiveReading {
  const v = 48 + 5 * Math.sin(t / 30) + (Math.random() - 0.5) * 0.8;
  const i = 10 + 2 * Math.cos(t / 20) + (Math.random() - 0.5) * 0.3;
  const temperature = 75 + Math.sin(t / 60) * 3 + (Math.random() - 0.5);
  return {
    timestamp: Date.now(),
    voltage: +v.toFixed(3),
    current: +i.toFixed(3),
    power: +((v * i) / 1000).toFixed(4),
    temperature: +temperature.toFixed(1),
  };
}

export function useWebSocket(options: UseWebSocketOptions | boolean = {}) {
  const opts: UseWebSocketOptions =
    typeof options === 'boolean' ? { demoMode: options } : options;
  const {
    url = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/ws/live',
    demoMode = false,
    bufferSize = DEFAULT_BUFFER,
    demoIntervalMs = DEFAULT_DEMO_INTERVAL,
    maxReconnectMs = DEFAULT_MAX_BACKOFF,
  } = opts;

  const [readings, setReadings] = useState<LiveReading[]>([]);
  const [wsStatus, setWsStatus] = useState<WsStatus>(demoMode ? 'demo' : 'connecting');
  const [lastError, setLastError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const demoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef(0);
  const attemptRef = useRef(0);
  const disposedRef = useRef(false);

  const pushReading = useCallback(
    (r: LiveReading) => {
      setReadings((prev) => {
        const next = prev.length >= bufferSize ? prev.slice(prev.length - bufferSize + 1) : prev.slice();
        next.push(r);
        return next;
      });
    },
    [bufferSize]
  );

  const clearReconnect = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const clearDemo = () => {
    if (demoIntervalRef.current) {
      clearInterval(demoIntervalRef.current);
      demoIntervalRef.current = null;
    }
  };

  const startDemo = useCallback(() => {
    clearDemo();
    demoIntervalRef.current = setInterval(() => {
      tickRef.current += 1;
      pushReading(synthesise(tickRef.current));
    }, demoIntervalMs);
  }, [demoIntervalMs, pushReading]);

  useEffect(() => {
    disposedRef.current = false;

    if (demoMode) {
      setWsStatus('demo');
      setLastError(null);
      startDemo();
      return () => {
        disposedRef.current = true;
        clearDemo();
      };
    }

    // Live mode: try to connect, auto-reconnect with exponential backoff,
    // fall back to synthetic data while disconnected so the UI is never empty.
    const connect = () => {
      if (disposedRef.current) return;
      setWsStatus('connecting');

      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        setLastError((err as Error).message);
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0;
        setLastError(null);
        setWsStatus('connected');
        clearDemo();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as LiveReading | LiveReading[];
          if (Array.isArray(data)) {
            data.forEach(pushReading);
          } else if (data && typeof data === 'object' && 'voltage' in data) {
            pushReading({ ...data, timestamp: data.timestamp ?? Date.now() });
          }
        } catch {
          // Ignore malformed frames silently — the backend may emit keepalives.
        }
      };

      ws.onerror = () => {
        setLastError('WebSocket error');
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (disposedRef.current) return;
        setWsStatus('disconnected');
        // Keep the dashboard alive with synthetic data until reconnect succeeds.
        if (!demoIntervalRef.current) startDemo();
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      clearReconnect();
      attemptRef.current += 1;
      const backoff = Math.min(maxReconnectMs, 500 * 2 ** Math.min(attemptRef.current, 6));
      reconnectTimerRef.current = setTimeout(connect, backoff);
    };

    connect();

    return () => {
      disposedRef.current = true;
      clearReconnect();
      clearDemo();
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [demoMode, url, maxReconnectMs, pushReading, startDemo]);

  const sendCommand = useCallback(
    (command: string, payload?: Record<string, unknown>) => {
      if (demoMode || wsStatus !== 'connected') {
        if (typeof window !== 'undefined') {
          // Visible in DevTools; backend is not involved in demo mode.
          // eslint-disable-next-line no-console
          console.info('[ws:demo] command suppressed', command, payload);
        }
        return false;
      }
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify({ type: 'scpi', command, ...payload }));
      return true;
    },
    [demoMode, wsStatus]
  );

  const clearReadings = useCallback(() => setReadings([]), []);

  return { readings, wsStatus, sendCommand, clearReadings, lastError };
}

export default useWebSocket;
