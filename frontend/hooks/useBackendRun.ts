/**
 * Mirror the local TestSession to a backend TestRun so the AI agent
 * can reach into it via tools. Cheap: one POST when the session opens,
 * one PATCH (telemetry batch) every couple of seconds while readings
 * stream in.
 */
import { useEffect, useRef } from 'react';
import { RunsAPI } from '@/lib/api';
import { useModuleStore } from '@/hooks/useModuleStore';
import type { LiveReading, TestSession } from '@/types/test-session';

interface Args {
  session: TestSession | null;
  readings: LiveReading[];
  testType: string;
  iecClause: string;
  params?: Record<string, unknown>;
}

const TELEMETRY_FLUSH_MS = 2000;

export function useBackendRun({ session, readings, testType, iecClause, params }: Args): void {
  const moduleId = useModuleStore((s) => s.selectedId);
  const setActiveRun = useModuleStore((s) => s.setActiveRun);
  const localIdRef = useRef<string | null>(null);
  const backendIdRef = useRef<string | null>(null);
  const flushedUntil = useRef<number>(0);
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Open a backend run when a fresh session arrives.
  useEffect(() => {
    if (!session || !moduleId) return;
    if (localIdRef.current === session.id) return;
    localIdRef.current = session.id;
    backendIdRef.current = null;
    flushedUntil.current = session.startTime;
    RunsAPI.create({
      module_id: moduleId,
      test_type: testType,
      iec_clause: iecClause,
      params: { ...(params || {}), local_session_id: session.id },
      operator: '',
    })
      .then((r) => {
        if (localIdRef.current !== session.id) return;
        backendIdRef.current = r.run_id;
        setActiveRun(r.run_id);
      })
      .catch(() => {
        /* AI panel will surface the underlying network error */
      });
  }, [session, moduleId, testType, iecClause, params, setActiveRun]);

  // Flush telemetry periodically while the run is active.
  useEffect(() => {
    if (!session) {
      if (flushTimer.current) clearInterval(flushTimer.current);
      flushTimer.current = null;
      return;
    }
    flushTimer.current = setInterval(() => {
      const runId = backendIdRef.current;
      if (!runId) return;
      const cutoff = flushedUntil.current;
      const fresh = readings.filter((r) => r.timestamp > cutoff);
      if (fresh.length === 0) return;
      flushedUntil.current = fresh[fresh.length - 1].timestamp;
      void RunsAPI.appendTelemetry(
        runId,
        fresh.map((r) => ({
          t: r.timestamp / 1000,
          voltage: r.voltage,
          current: r.current,
          power: r.power,
          temperature: r.temperature ?? null,
        })),
      ).catch(() => {});
    }, TELEMETRY_FLUSH_MS);
    return () => {
      if (flushTimer.current) clearInterval(flushTimer.current);
      flushTimer.current = null;
    };
  }, [session, readings]);

  // Patch terminal state when a session resolves.
  useEffect(() => {
    if (!session || !backendIdRef.current) return;
    if (session.status !== 'pass' && session.status !== 'fail' && session.status !== 'aborted') return;
    const status = session.status === 'pass' ? 'passed' : session.status === 'fail' ? 'failed' : 'aborted';
    void RunsAPI.patch(backendIdRef.current, {
      status,
      pass_fail: session.result ?? null,
      ended_at: session.endTime ? new Date(session.endTime).toISOString() : null,
    }).catch(() => {});
  }, [session]);
}
