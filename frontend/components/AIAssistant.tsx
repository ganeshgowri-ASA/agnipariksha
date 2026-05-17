'use client';

import { useMemo } from 'react';
import type { TestSession, LiveReading } from '@/types/test-session';
import { useModuleId } from './ModuleIdContext';
import ThreadedAssistant from './ThreadedAssistant';

interface Props {
  sessions: Record<string, TestSession | null>;
  readings: LiveReading[];
}

/**
 * The /AI tab. Same component as the in-tab rail, but full-page and with a
 * richer context payload built from every active session — useful when the
 * operator wants a cross-test summary for the current module.
 */
export default function AIAssistant({ sessions, readings }: Props) {
  const { moduleId } = useModuleId();

  const context = useMemo(() => {
    const summary = Object.entries(sessions)
      .filter(([, s]) => s != null)
      .map(([k, s]) => ({
        tab: k,
        status: s!.status,
        result: s!.result ?? null,
        readings: s!.readings.length,
        startTime: s!.startTime,
      }));
    const last = readings.slice(-3);
    return { sessions: summary, latest_readings: last, tab: 'ai' };
  }, [sessions, readings]);

  return (
    <div className="h-full bg-gray-950">
      <ThreadedAssistant moduleId={moduleId} context={context} />
    </div>
  );
}
