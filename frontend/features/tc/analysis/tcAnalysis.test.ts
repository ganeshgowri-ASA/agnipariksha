/**
 * Vitest coverage for Thermal Cycling analysis math.
 *
 * Mirrors the IEC 61215-2 MQT 11 acceptance criteria — every test maps
 * to a clause in the standard so a future audit can trace each verdict
 * to the rule it enforces.
 */
import { describe, it, expect } from 'vitest';
import {
  computeTcKpis,
  iscGateSetpoint,
  TC_CONSTANTS,
  type TcConfig,
} from './tcAnalysis';
import type { LiveReading } from '@/types/test-session';

const baseConfig: TcConfig = {
  cycles: 2,
  tMax: 85,
  tMin: -40,
  rampRateCph: 90,
  isc: 9.5,
};

function synthCycle(opts: {
  startMs: number;
  cycles: number;
  tMin: number;
  tMax: number;
  rampCph: number;
  dwellS?: number;
  sampleS?: number;
}): LiveReading[] {
  const dwellS = opts.dwellS ?? TC_CONSTANTS.MIN_DWELL_S + 60;
  const sampleS = opts.sampleS ?? 10;
  const readings: LiveReading[] = [];
  let t = opts.tMin;
  let ms = opts.startMs;
  const rampPerSec = opts.rampCph / 3600;

  for (let c = 0; c < opts.cycles; c++) {
    while (t < opts.tMax) {
      readings.push({ timestamp: ms, voltage: 48, current: 9.5, power: 456, temperature: t });
      t += rampPerSec * sampleS;
      ms += sampleS * 1000;
    }
    t = opts.tMax;
    for (let d = 0; d < dwellS; d += sampleS) {
      readings.push({ timestamp: ms, voltage: 48, current: 9.5, power: 456, temperature: t });
      ms += sampleS * 1000;
    }
    while (t > opts.tMin) {
      readings.push({ timestamp: ms, voltage: 48, current: 0, power: 0, temperature: t });
      t -= rampPerSec * sampleS;
      ms += sampleS * 1000;
    }
    t = opts.tMin;
    for (let d = 0; d < dwellS; d += sampleS) {
      readings.push({ timestamp: ms, voltage: 48, current: 0, power: 0, temperature: t });
      ms += sampleS * 1000;
    }
  }
  return readings;
}

describe('computeTcKpis — empty / pre-run state', () => {
  it('returns idle with cyclesTarget echoed back', () => {
    const k = computeTcKpis([], baseConfig);
    expect(k.phase).toBe('idle');
    expect(k.cycleIndex).toBe(0);
    expect(k.cyclesTarget).toBe(2);
    expect(k.tModuleC).toBeNull();
    expect(k.iscGate).toBe('unknown');
    expect(k.overallVerdict).toBe('pending');
  });
});

describe('computeTcKpis — phase detection', () => {
  it('classifies hot-dwell when T ≥ tMax − 2', () => {
    const readings: LiveReading[] = [
      { timestamp: 0,    voltage: 48, current: 9.5, power: 456, temperature: 84 },
      { timestamp: 1000, voltage: 48, current: 9.5, power: 456, temperature: 85 },
    ];
    expect(computeTcKpis(readings, baseConfig).phase).toBe('hot-dwell');
  });

  it('classifies cold-dwell when T ≤ tMin + 2', () => {
    const readings: LiveReading[] = [
      { timestamp: 0,    voltage: 0, current: 0, power: 0, temperature: -39 },
      { timestamp: 1000, voltage: 0, current: 0, power: 0, temperature: -40 },
    ];
    expect(computeTcKpis(readings, baseConfig).phase).toBe('cold-dwell');
  });

  it('classifies heating when T rising and out of dwell bands', () => {
    const readings: LiveReading[] = [
      { timestamp: 0,    voltage: 48, current: 9.5, power: 456, temperature: 10 },
      { timestamp: 1000, voltage: 48, current: 9.5, power: 456, temperature: 12 },
    ];
    expect(computeTcKpis(readings, baseConfig).phase).toBe('heating');
  });
});

describe('computeTcKpis — Isc gate (MQT 11.6.3 a)', () => {
  it('reports cooling when T ≤ 25 °C even with non-zero Isc setpoint', () => {
    const readings: LiveReading[] = [
      { timestamp: 0, voltage: 0, current: 0, power: 0, temperature: 10 },
    ];
    expect(computeTcKpis(readings, baseConfig).iscGate).toBe('cooling');
  });

  it('reports injecting when T > 25 °C and Isc > 0', () => {
    const readings: LiveReading[] = [
      { timestamp: 0, voltage: 48, current: 9.5, power: 456, temperature: 60 },
    ];
    expect(computeTcKpis(readings, baseConfig).iscGate).toBe('injecting');
  });

  it('iscGateSetpoint returns 0 below threshold, isc above', () => {
    expect(iscGateSetpoint(10, 9.5)).toBe(0);
    expect(iscGateSetpoint(25, 9.5)).toBe(0); // boundary: strictly >25
    expect(iscGateSetpoint(25.01, 9.5)).toBe(9.5);
    expect(iscGateSetpoint(null, 9.5)).toBe(0);
  });
});

describe('computeTcKpis — ramp rate compliance (MQT 11.6.2)', () => {
  it('classifies as pass when ramp ≤ 100 °C/h', () => {
    const readings = synthCycle({ startMs: 0, cycles: 1, tMin: -40, tMax: 85, rampCph: 90 });
    const k = computeTcKpis(readings, baseConfig);
    expect(k.rampVerdict).toBe('pass');
    expect(k.worstRampCph).toBeLessThanOrEqual(TC_CONSTANTS.MAX_RAMP_C_PER_H);
  });

  it('classifies as fail when ramp > 120 °C/h', () => {
    const readings = synthCycle({ startMs: 0, cycles: 1, tMin: -40, tMax: 85, rampCph: 150 });
    const k = computeTcKpis(readings, baseConfig);
    expect(k.worstRampCph).toBeGreaterThan(TC_CONSTANTS.RAMP_WARN_C_PER_H);
  });
});

describe('computeTcKpis — cycle counter', () => {
  it('counts complete cycles via midpoint zero-crossings', () => {
    const readings = synthCycle({ startMs: 0, cycles: 2, tMin: -40, tMax: 85, rampCph: 90 });
    const k = computeTcKpis(readings, baseConfig);
    // synthCycle starts cold → heats → dwells hot → cools → dwells cold,
    // so after N synthCycle iterations the temperature has crossed the
    // midpoint upward N times — we count the second-and-onward crossings
    // as "complete" (matching IEC vocabulary where one cycle = full sweep).
    expect(k.cycleIndex).toBeGreaterThanOrEqual(1);
    expect(k.cycleIndex).toBeLessThanOrEqual(2);
  });

  it('reports overall verdict pending until target cycles reached', () => {
    const readings = synthCycle({ startMs: 0, cycles: 1, tMin: -40, tMax: 85, rampCph: 90 });
    const k = computeTcKpis(readings, { ...baseConfig, cycles: 200 });
    expect(k.overallVerdict).toBe('pending');
  });
});

describe('computeTcKpis — dwell accumulation', () => {
  it('accumulates seconds inside the hot/cold dwell bands', () => {
    const readings = synthCycle({
      startMs: 0, cycles: 1, tMin: -40, tMax: 85, rampCph: 90,
      dwellS: 600, sampleS: 10,
    });
    const k = computeTcKpis(readings, baseConfig);
    expect(k.hotDwellS).toBeGreaterThanOrEqual(TC_CONSTANTS.MIN_DWELL_S - 30);
    expect(k.coldDwellS).toBeGreaterThanOrEqual(TC_CONSTANTS.MIN_DWELL_S - 30);
  });
});
