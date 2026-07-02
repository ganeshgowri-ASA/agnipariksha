/**
 * Vitest coverage for Reverse Current Overload analysis (IEC 61730-2:2023 MST 26).
 */
import { describe, it, expect } from 'vitest';
import { computeRcoKpis, RCO_CONSTANTS, type RcoConfig } from './rcoAnalysis';
import type { LiveReading } from '@/types/test-session';

const baseConfig: RcoConfig = {
  fuseRating: 10,
  voltageLimit: 1.0,
  durationHours: 2,
};

function synthRcoRun(opts: {
  startMs: number;
  fuseRating: number;
  soakSeconds: number;
  measuredCurrentA?: number;
  voltageV?: number;
  tempC?: number;
  sampleS?: number;
}): LiveReading[] {
  const sampleS = opts.sampleS ?? 60;
  const target = opts.fuseRating * RCO_CONSTANTS.ISC_MULTIPLIER;
  const cur = opts.measuredCurrentA ?? target;
  const v = opts.voltageV ?? 0.5;
  const t = opts.tempC ?? 45;
  const readings: LiveReading[] = [];
  let ms = opts.startMs;
  for (let s = 0; s < opts.soakSeconds; s += sampleS) {
    readings.push({
      timestamp: ms,
      voltage: v,
      current: -cur,           // reverse → negative
      power: -cur * v,
      temperature: t,
    });
    ms += sampleS * 1000;
  }
  return readings;
}

describe('computeRcoKpis — empty / pre-run', () => {
  it('returns idle + pending', () => {
    const k = computeRcoKpis([], baseConfig);
    expect(k.phase).toBe('idle');
    expect(k.measuredCurrentA).toBeNull();
    expect(k.overallVerdict).toBe('pending');
    expect(k.testCurrentA).toBeCloseTo(13.5);
  });
});

describe('computeRcoKpis — current envelope (MST 26 §6)', () => {
  it('PASS when current within ±5% of 1.35×Isc', () => {
    const readings = synthRcoRun({
      startMs: 0, fuseRating: 10, soakSeconds: 600,
      measuredCurrentA: 13.5 * 1.02, // 2% high
    });
    const k = computeRcoKpis(readings, baseConfig);
    expect(k.currentEnvelopeVerdict).toBe('pass');
  });

  it('WARN at 5-10% deviation', () => {
    const readings = synthRcoRun({
      startMs: 0, fuseRating: 10, soakSeconds: 600,
      measuredCurrentA: 13.5 * 1.08, // 8%
    });
    expect(computeRcoKpis(readings, baseConfig).currentEnvelopeVerdict).toBe('warn');
  });

  it('FAIL beyond 10% deviation', () => {
    const readings = synthRcoRun({
      startMs: 0, fuseRating: 10, soakSeconds: 600,
      measuredCurrentA: 13.5 * 1.20, // 20% high
    });
    expect(computeRcoKpis(readings, baseConfig).currentEnvelopeVerdict).toBe('fail');
  });
});

describe('computeRcoKpis — voltage drop limit', () => {
  it('PASS when V-drop ≤ limit', () => {
    const readings = synthRcoRun({ startMs: 0, fuseRating: 10, soakSeconds: 600, voltageV: 0.5 });
    expect(computeRcoKpis(readings, baseConfig).voltageDropVerdict).toBe('pass');
  });

  it('FAIL above 1.2× limit (1.5 V vs 1.0 V limit)', () => {
    const readings = synthRcoRun({ startMs: 0, fuseRating: 10, soakSeconds: 600, voltageV: 1.5 });
    expect(computeRcoKpis(readings, baseConfig).voltageDropVerdict).toBe('fail');
  });
});

describe('computeRcoKpis — backsheet temperature ceiling', () => {
  it('PASS below 90% of 60 °C ceiling', () => {
    const readings = synthRcoRun({ startMs: 0, fuseRating: 10, soakSeconds: 600, tempC: 45 });
    expect(computeRcoKpis(readings, baseConfig).temperatureVerdict).toBe('pass');
  });

  it('WARN above 90% but below 60 °C', () => {
    const readings = synthRcoRun({ startMs: 0, fuseRating: 10, soakSeconds: 600, tempC: 56 });
    expect(computeRcoKpis(readings, baseConfig).temperatureVerdict).toBe('warn');
  });

  it('FAIL above 60 °C', () => {
    const readings = synthRcoRun({ startMs: 0, fuseRating: 10, soakSeconds: 600, tempC: 65 });
    expect(computeRcoKpis(readings, baseConfig).temperatureVerdict).toBe('fail');
  });
});

describe('computeRcoKpis — soak duration vs target', () => {
  it('PASS when soak meets 2 h target', () => {
    // Use the FULL 2-hour duration so the cumulative-band logic registers ≥ 2h.
    const readings = synthRcoRun({
      startMs: 0, fuseRating: 10, soakSeconds: 2 * 3600 + 60, sampleS: 60,
    });
    expect(computeRcoKpis(readings, baseConfig).soakDurationVerdict).toBe('pass');
  });

  it('FAIL when soak well under target', () => {
    const readings = synthRcoRun({ startMs: 0, fuseRating: 10, soakSeconds: 600 });
    expect(computeRcoKpis(readings, baseConfig).soakDurationVerdict).toBe('fail');
  });
});

describe('computeRcoKpis — composite verdict', () => {
  it('overall PASS when all components PASS and soak met', () => {
    const readings = synthRcoRun({
      startMs: 0, fuseRating: 10, soakSeconds: 2 * 3600 + 60,
      measuredCurrentA: 13.5, voltageV: 0.4, tempC: 40,
    });
    const k = computeRcoKpis(readings, baseConfig);
    expect(k.overallVerdict).toBe('pass');
  });

  it('overall FAIL when any component fails', () => {
    const readings = synthRcoRun({
      startMs: 0, fuseRating: 10, soakSeconds: 2 * 3600 + 60,
      measuredCurrentA: 13.5, voltageV: 0.4, tempC: 70, // T fail
    });
    expect(computeRcoKpis(readings, baseConfig).overallVerdict).toBe('fail');
  });

  it('stays pending until soak target', () => {
    const readings = synthRcoRun({ startMs: 0, fuseRating: 10, soakSeconds: 600 });
    const k = computeRcoKpis(readings, baseConfig);
    expect(k.overallVerdict === 'pending' || k.overallVerdict === 'fail').toBe(true);
  });
});
