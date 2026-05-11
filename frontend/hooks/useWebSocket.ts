'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { LiveReading } from '@/app/page';

type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'demo';

function generateDemoReading(t: number, testType: string = 'generic'): LiveReading {
  const base = { timestamp: Date.now() };
  const noise = () => (Math.random() - 0.5) * 0.02;

  switch (testType) {
    case 'letid':
      return { ...base, voltage: 35.0 + noise(), current: +(Math.sin(t / 1000) * 2 + 8 + noise()).toFixed(3), power: 0, temperature: 75 + noise() * 3 };
    case 'rco':
      return { ...base, voltage: 0.5 + noise(), current: +(13.5 + Math.sin(t / 500) * 0.5 + noise()).toFixed(3), power: 0, temperature: 25 + noise() };
    case 'gct':
      return { ...base, voltage: 2.0 + noise(), current: +(25.1 + noise() * 0.1).toFixed(3), power: 0, temperature: 25 };
    default:
      return {
        ...base,
        voltage: +(35.0 + Math.sin(t / 2000) * 0.5 + noise()).toFixed(3),
        current: +(8.5 + Math.cos(t / 1500) * 0.3 + noise()).toFixed(3),
        power: 0,
        temperature: +(25 + Math.sin(t / 3000) * 2).toFixed(1),
      };
  }
}

export function useWebSocket(demoMode: boolean = true) {
  const [readings, setReadings] = useState<LiveReading[]>([]);
  const [wsStatus, setWsStatus] = useState<WsStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const demoIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(Date.now());

  const sendCommand = useCallback((cmd: string) => {
    if (demoMode) {
      console.log('[DEMO] SCPI Command:', cmd);
      return;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'command', payload: cmd }));
    }
  }, [demoMode]);

  useEffect(() => {
    if (demoMode) {
      setWsStatus('demo');
      startTimeRef.current = Date.now();
      demoIntervalRef.current = setInterval(() => {
        const t = Date.now() - startTimeRef.current;
        const reading = generateDemoReading(t);
        reading.power = +((reading.voltage * reading.current)).toFixed(3);
        setReadings(prev => {
          const next = [...prev, reading];
          return next.length > 300 ? next.slice(-300) : next;
        });
      }, 500);
      return () => {
        if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
      };
    }

    const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/ws/live';
    setWsStatus('connecting');
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setWsStatus('connected');
    ws.onclose = () => setWsStatus('disconnected');
    ws.onerror = () => setWsStatus('disconnected');
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as LiveReading;
        data.power = +((data.voltage * data.current)).toFixed(3);
        setReadings(prev => {
          const next = [...prev, data];
          return next.length > 300 ? next.slice(-300) : next;
        });
      } catch {}
    };

    return () => ws.close();
  }, [demoMode]);

  return { readings, wsStatus, sendCommand };
}
