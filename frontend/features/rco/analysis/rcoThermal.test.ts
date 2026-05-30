/**
 * Vitest coverage for the RCO forward-bias + thermal helpers
 * (IEC 61730-2 MST 26): the 1.35×Isc forward setpoint, the 1–2 h hold
 * clamp, and the module-temperature trace / overheat verdict.
 */
import { describe, it, expect } from 'vitest';
import {
  forwardBiasSetpoint,
  clampHoldHours,
  moduleTempTrace,
  RCO_THERMAL_CONSTANTS,
  type ModuleTempReading,
} from './rcoThermal';
import type { LiveReading } from '@/types/test-session';

describe('forwardBiasSetpoint — MST 26 §6 (1.35×Isc)', () => {
  it('returns 1.35 × Isc', () => {
    expect(forwardBiasSetpoint(10)).toBeCloseTo(13.5);
    expect(forwardBiasSetpoint(9.5)).toBeCloseTo(12.825);
  });

  it('uses the pinned multiplier constant', () => {
    expect(RCO_THERMAL_CONSTANTS.ISC_FORWARD_MULTIPLIER).toBe(1.35);
    expect(forwardBiasSetpoint(1)).toBeCloseTo(RCO_THERMAL_CONSTANTS.ISC_FORWARD_MULTIPLIER);
  });

  it('handles zero', () => {
    expect(forwardBiasSetpoint(0)).toBe(0);
  });
});

describe('clampHoldHours — MST 26 §6 [1, 2] h window', () => {
  it('passes through in-range values unchanged', () => {
    expect(clampHoldHours(1)).toBe(1);
    expect(clampHoldHours(1.5)).toBe(1.5);
    expect(clampHoldHours(2)).toBe(2);
  });

  it('clamps below the 1 h minimum', () => {
    expect(clampHoldHours(0.5)).toBe(RCO_THERMAL_CONSTANTS.HOLD_MIN_H);
    expect(clampHoldHours(0)).toBe(1);
    expect(clampHoldHours(-3)).toBe(1);
  });

  it('clamps above the 2 h maximum', () => {
    expect(clampHoldHours(2.5)).toBe(RCO_THERMAL_CONSTANTS.HOLD_MAX_H);
    expect(clampHoldHours(10)).toBe(2);
  });

  it('falls back to the minimum on NaN', () => {
    expect(clampHoldHours(Number.NaN)).toBe(RCO_THERMAL_CONSTANTS.HOLD_MIN_H);
  });
});

function synthTemps(opts: {
  startMs: number;
  count: number;
  baseC: number;
  stepC?: number;
  sampleS?: number;
}): ModuleTempReading[] {
  const stepC = opts.stepC ?? 0;
  const sampleS = opts.sampleS ?? 60;
  const out: ModuleTempReading[] = [];
  for (let i = 0; i < opts.count; i++) {
    out.push({ timestamp: opts.startMs + i * sampleS * 1000, tempC: opts.baseC + i * stepC });
  }
  return out;
}

describe('moduleTempTrace — temperature vs time + overheat verdict', () => {
  it('returns pending with no samples', () => {
    const tr = moduleTempTrace([]);
    expect(tr.points).toEqual([]);
    expect(tr.peakC).toBeNull();
    expect(tr.verdict).toBe('pending');
  });

  it('builds points in minutes since the first sample and tracks the peak', () => {
    const readings = synthTemps({ startMs: 1000, count: 4, baseC: 40, stepC: 5, sampleS: 60 });
    const tr = moduleTempTrace(readings);
    expect(tr.points).toHaveLength(4);
    expect(tr.points[0].tMin).toBeCloseTo(0);
    expect(tr.points[1].tMin).toBeCloseTo(1);
    expect(tr.points[3].tMin).toBeCloseTo(3);
    expect(tr.peakC).toBeCloseTo(55); // 40 + 3*5
  });

  it('PASS when peak stays well below the ceiling', () => {
    const tr = moduleTempTrace(synthTemps({ startMs: 0, count: 5, baseC: 50 }));
    expect(tr.verdict).toBe('pass');
  });

  it('WARN within the margin of the ceiling', () => {
    const warnC = RCO_THERMAL_CONSTANTS.T_CEILING_C - RCO_THERMAL_CONSTANTS.T_WARN_MARGIN_C + 1; // 81
    const tr = moduleTempTrace(synthTemps({ startMs: 0, count: 3, baseC: warnC }));
    expect(tr.verdict).toBe('warn');
  });

  it('FAIL at or above the ceiling', () => {
    const tr = moduleTempTrace(synthTemps({ startMs: 0, count: 3, baseC: RCO_THERMAL_CONSTANTS.T_CEILING_C + 5 }));
    expect(tr.verdict).toBe('fail');
  });

  it('accepts shared LiveReading samples via the temperature field', () => {
    const live: LiveReading[] = [
      { timestamp: 0, voltage: 0.5, current: 13.5, power: 6.75, temperature: 42 },
      { timestamp: 60_000, voltage: 0.5, current: 13.5, power: 6.75, temperature: 48 },
    ];
    const tr = moduleTempTrace(live);
    expect(tr.points).toHaveLength(2);
    expect(tr.peakC).toBeCloseTo(48);
    expect(tr.verdict).toBe('pass');
  });

  it('skips samples with no temperature', () => {
    const live: LiveReading[] = [
      { timestamp: 0, voltage: 0.5, current: 13.5, power: 6.75 }, // no temperature
      { timestamp: 60_000, voltage: 0.5, current: 13.5, power: 6.75, temperature: 50 },
    ];
    const tr = moduleTempTrace(live);
    expect(tr.points).toHaveLength(1);
    expect(tr.points[0].tMin).toBeCloseTo(0); // re-based on the first VALID sample
    expect(tr.peakC).toBeCloseTo(50);
  });
});
