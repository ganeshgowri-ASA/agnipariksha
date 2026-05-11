'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import type { LiveReading } from '@/types/test-session';
import { useNotifications } from '@/components/notifications/NotificationsStore';

type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'demo';

const DEMO_SCENARIOS: Record<string, { v: number; i: number; label: string }> = {
  tc:    { v: 48.0,  i: 10.0, label: 'Thermal Cycling' },
  hf:    { v: 24.0,  i: 5.0,  label: 'Humidity Freeze' },
  letid: { v: 36.0,  i: 8.5,  label: 'LeTID' },
  bdt:   { v: 12.0,  i: 15.0, label: 'Bypass Diode' },
  rco:   { v: 60.0,  i: 20.0, label: 'Reverse Current Overload' },
  gct:   { v: 6.0,   i: 25.0, label: 'Ground Continuity' },
};

export function useWebSocket(demoMode: boolean = true) {
  const [readings, setReadings] = useState<LiveReading[]>([]);
  const [wsStatus, setWsStatus] = useState<WsStatus>(demoMode ? 'demo' : 'connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const demoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tRef = useRef(0);
  const { push: pushNotification } = useNotifications();

  const addReading = useCallback((r: LiveReading) => {
    setReadings(prev => {
      const next = [...prev, r];
      return next.length > 300 ? next.slice(-300) : next;
    });
  }, []);

  useEffect(() => {
    if (demoMode) {
      setWsStatus('demo');
      if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);

      demoIntervalRef.current = setInterval(() => {
        tRef.current += 1;
        const t = tRef.current;
        // Simulate realistic PV test waveform with noise
        const v = 48 + 5 * Math.sin(t / 30) + (Math.random() - 0.5) * 0.8;
        const i = 10 + 2 * Math.cos(t / 20) + (Math.random() - 0.5) * 0.3;
        addReading({
          timestamp: Date.now(),
          voltage: +v.toFixed(3),
          current: +i.toFixed(3),
          power: +(v * i / 1000).toFixed(4),
          temperature: +(75 + Math.sin(t / 60) * 3 + (Math.random() - 0.5)).toFixed(1),
        });
      }, 500);

      return () => {
        if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
      };
    } else {
      // Real WebSocket to FastAPI backend (telemetry endpoint)
      const wsUrl =
        process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/ws/telemetry';
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      setWsStatus('connecting');

      ws.onopen = () => {
        setWsStatus('connected');
        pushNotification({
          severity: 'success', source: 'websocket',
          title: 'Telemetry connected',
          message: wsUrl,
        });
      };
      ws.onclose = () => {
        setWsStatus('disconnected');
        pushNotification({
          severity: 'warning', source: 'websocket',
          title: 'Telemetry disconnected',
          message: wsUrl,
        });
      };
      ws.onerror = () => {
        setWsStatus('disconnected');
        pushNotification({
          severity: 'error', source: 'websocket',
          title: 'WebSocket error',
          message: wsUrl,
        });
      };
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data?.type === 'scpi_timeout') {
            pushNotification({
              severity: 'error', source: 'scpi',
              title: 'SCPI timeout',
              message: data.command ?? 'Unknown command',
            });
            return;
          }
          if (data?.type === 'gate_failure') {
            pushNotification({
              severity: 'error', source: 'gate',
              title: 'Gate threshold breached',
              message: data.message ?? 'Gate-2 ΔPmax exceeded',
              testId: data.testId,
            });
            return;
          }
          if (
            typeof data?.timestamp === 'number'
            && typeof data?.voltage === 'number'
            && typeof data?.current === 'number'
            && typeof data?.power === 'number'
          ) {
            addReading(data as LiveReading);
          }
        } catch {
          /* malformed frames ignored */
        }
      };

      return () => { ws.close(); };
    }
  }, [demoMode, addReading, pushNotification]);

  const sendCommand = useCallback((cmd: string) => {
    if (demoMode) {
      console.log('[DEMO] SCPI Command:', cmd);
      return;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'scpi', command: cmd }));
    }
  }, [demoMode]);

  return { readings, wsStatus, sendCommand };
}
