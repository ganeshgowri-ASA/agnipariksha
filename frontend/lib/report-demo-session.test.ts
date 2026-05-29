import { describe, it, expect } from 'vitest';
import { resolveReportSession, buildDemoReadings } from './report-demo-session';
import type { TestSession } from '@/types/test-session';

describe('resolveReportSession', () => {
  it('synthesizes a renderable PASS session when there is no live run', () => {
    const { session, isDemo } = resolveReportSession(null, { testType: 'tc' });
    expect(isDemo).toBe(true);
    expect(session.readings.length).toBeGreaterThan(0);
    expect(session.id).toContain('DEMO-tc');
    expect(session.result).toBe('PASS');
    // ΔPmax encoded by the demo pre/post stays inside the −5 % Gate-2 floor.
    const delta = ((session.postMaxPower! - session.preMaxPower!) / session.preMaxPower!) * 100;
    expect(delta).toBeGreaterThanOrEqual(-5);
    expect(delta).toBeLessThan(0);
  });

  it('synthesizes content for a started-but-empty session, preserving its id', () => {
    const started: TestSession = {
      id: 'TC-42', testType: 'thermal_cycling', startTime: 1_000, status: 'running', readings: [],
    };
    const { session, isDemo } = resolveReportSession(started, { testType: 'tc' });
    expect(isDemo).toBe(true);
    expect(session.id).toBe('TC-42');
    expect(session.status).toBe('running');
    expect(session.readings.length).toBeGreaterThan(0);
  });

  it('returns a real run with readings untouched', () => {
    const real: TestSession = {
      id: 'TC-7', testType: 'thermal_cycling', startTime: 1_000, status: 'pass',
      readings: [{ timestamp: 1_000, voltage: 48, current: 10, power: 480 }],
      preMaxPower: 500, postMaxPower: 495,
    };
    const { session, isDemo } = resolveReportSession(real, { testType: 'tc' });
    expect(isDemo).toBe(false);
    expect(session).toBe(real);
  });

  it('buildDemoReadings is deterministic', () => {
    expect(buildDemoReadings(0)).toEqual(buildDemoReadings(0));
  });
});
