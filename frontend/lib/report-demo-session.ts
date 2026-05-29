/**
 * Demo-session resolver for the Report tab.
 *
 * Export PDF / Word must work in DEMO_MODE without a live PSU run. A real
 * run (a session that already carries readings) is returned untouched;
 * otherwise we synthesize a deterministic session so the report always has
 * renderable content. Any metadata from a real-but-empty session (id,
 * operator-entered fields persisted elsewhere, status) is preserved.
 */
import type { LiveReading, TestSession } from '@/types/test-session';

const DEMO_POINTS = 48;

/** ~-1.8 % ΔPmax — comfortably inside the −5 % Gate-2 floor, so the demo
 *  report renders a clean PASS verdict. */
const DEMO_PRE_PMAX = 305.2;
const DEMO_POST_PMAX = 299.8;

/** Deterministic synthetic telemetry (no RNG) so reports + tests are stable. */
export function buildDemoReadings(start: number): LiveReading[] {
  const out: LiveReading[] = [];
  for (let i = 0; i < DEMO_POINTS; i++) {
    const v = 48 + 4 * Math.sin(i / 7);
    const a = 10 + 1.5 * Math.cos(i / 5);
    out.push({
      timestamp: start + i * 60_000,
      voltage: +v.toFixed(3),
      current: +a.toFixed(3),
      power: +(v * a).toFixed(3),
      temperature: +(75 + 3 * Math.sin(i / 11)).toFixed(1),
    });
  }
  return out;
}

export interface ResolvedReportSession {
  session: TestSession;
  /** true when the content is synthesized (no live readings were available). */
  isDemo: boolean;
}

export function resolveReportSession(
  session: TestSession | null,
  opts: { testType?: string } = {},
): ResolvedReportSession {
  if (session && session.readings.length > 0) {
    return { session, isDemo: false };
  }

  const start = session?.startTime ?? Date.now() - DEMO_POINTS * 60_000;
  const readings = buildDemoReadings(start);
  return {
    isDemo: true,
    session: {
      id: session?.id ?? `DEMO-${opts.testType ?? 'test'}-${start}`,
      testType: session?.testType ?? opts.testType ?? 'demo',
      startTime: start,
      endTime: session?.endTime ?? readings[readings.length - 1].timestamp,
      status: session?.status && session.status !== 'idle' ? session.status : 'pass',
      readings,
      result: session?.result ?? 'PASS',
      preMaxPower: session?.preMaxPower ?? DEMO_PRE_PMAX,
      postMaxPower: session?.postMaxPower ?? DEMO_POST_PMAX,
      iecClause: session?.iecClause,
      rawDataPath: session?.rawDataPath,
      notes: session?.notes,
    },
  };
}
