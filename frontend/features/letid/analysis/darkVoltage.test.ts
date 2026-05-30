import { describe, it, expect } from 'vitest';
import {
  darkVoltageSeries,
  stopCriterion,
  measurementUncertainty,
  LETID_DARKV_CONSTANTS,
  type DarkVoltagePoint,
} from './darkVoltage';
import type { LiveReading } from '@/types/test-session';

const HOUR_MS = 3_600_000;

/** Build a LiveReading at `hours` from t0 with the given voltage/current/temp. */
function reading(hours: number, voltage: number, current: number, temperature?: number): LiveReading {
  return {
    timestamp: hours * HOUR_MS,
    voltage,
    current,
    power: voltage * current,
    temperature,
  };
}

describe('darkVoltageSeries — extracts dark-phase samples only', () => {
  it('keeps no-injection samples and drops injection samples', () => {
    const readings: LiveReading[] = [
      reading(0, 0.62, 0.0, 75), // dark
      reading(1, 37.5, 1.2, 75), // injection — current well above eps
      reading(2, 0.61, 0.01, 74), // dark (within eps)
      reading(3, 37.4, 1.18, 76), // injection
      reading(4, 0.60, -0.02, 75), // dark (small negative current within eps)
    ];
    const series = darkVoltageSeries(readings);
    expect(series.map((p) => p.hours)).toEqual([0, 2, 4]);
    expect(series.map((p) => p.darkVoltage)).toEqual([0.62, 0.61, 0.6]);
    // Temperature and current are carried through for the shared-axis plot.
    expect(series.map((p) => p.temperature)).toEqual([75, 74, 75]);
    expect(series.every((p) => Math.abs(p.current) <= LETID_DARKV_CONSTANTS.DARK_CURRENT_EPS_A)).toBe(true);
  });

  it('measures hours from the first reading, not the first dark sample', () => {
    const readings: LiveReading[] = [
      reading(10, 37.5, 1.2, 75), // injection first
      reading(12, 0.61, 0.0, 75), // first dark sample at +2 h
    ];
    const series = darkVoltageSeries(readings);
    expect(series).toHaveLength(1);
    expect(series[0].hours).toBeCloseTo(2, 9); // 12 h − 10 h origin
  });

  it('is robust to unsorted input and returns [] for empty input', () => {
    expect(darkVoltageSeries([])).toEqual([]);
    const unsorted: LiveReading[] = [
      reading(4, 0.60, 0, 75),
      reading(0, 0.62, 0, 75),
      reading(2, 0.61, 0, 75),
    ];
    const series = darkVoltageSeries(unsorted);
    expect(series.map((p) => p.hours)).toEqual([0, 2, 4]);
  });

  it('honours a custom dark-current epsilon', () => {
    const readings: LiveReading[] = [reading(0, 0.6, 0.1, 75)];
    expect(darkVoltageSeries(readings)).toHaveLength(0); // 0.1 A > default 0.05 eps
    expect(darkVoltageSeries(readings, { darkCurrentEpsA: 0.2 })).toHaveLength(1);
  });
});

describe('stopCriterion — TS 63342 stabilization', () => {
  /** A flat (stabilized) dark-voltage tail spanning `spanHrs` ending at `endHrs`. */
  function flatSeries(endHrs: number, spanHrs: number, v: number, jitter = 0): DarkVoltagePoint[] {
    const pts: DarkVoltagePoint[] = [];
    for (let h = endHrs - spanHrs; h <= endHrs + 1e-9; h += 2) {
      pts.push({ hours: +h.toFixed(2), darkVoltage: v + (jitter ? jitter * Math.sin(h) : 0), current: 0 });
    }
    return pts;
  }

  it('met=true when trailing drift is within threshold after the minimum soak', () => {
    // 200 h soak, last 24 h flat to ~0.1 mV on a 0.6 V level → ΔV/V ≈ 0.03 %.
    const series = flatSeries(200, 200, 0.6, 0.00005);
    const r = stopCriterion(series);
    expect(r.met).toBe(true);
    expect(r.relativeDrift as number).toBeLessThan(LETID_DARKV_CONSTANTS.STABILIZATION_REL_THRESHOLD);
    expect(r.reason).toContain('Stabilized');
  });

  it('met=false when the trailing window still drifts above threshold', () => {
    // Long soak but a clear downward slope over the trailing window.
    const series: DarkVoltagePoint[] = [];
    for (let h = 0; h <= 200; h += 2) series.push({ hours: h, darkVoltage: 0.62 - 0.0002 * h, current: 0 });
    const r = stopCriterion(series);
    expect(r.met).toBe(false);
    expect(r.reason).toContain('Not stabilized');
    expect(r.relativeDrift as number).toBeGreaterThan(LETID_DARKV_CONSTANTS.STABILIZATION_REL_THRESHOLD);
  });

  it('met=false when stable but the minimum soak has not elapsed', () => {
    // Perfectly flat, but only 50 h of soak (< 162 h minimum).
    const series = flatSeries(50, 50, 0.6);
    const r = stopCriterion(series);
    expect(r.met).toBe(false);
    expect(r.reason).toContain('< 162 h minimum');
    expect(r.relativeDrift).toBe(0);
  });

  it('met=false when the trailing window is not yet full', () => {
    // Only 10 h of data — narrower than the 24 h window.
    const series = flatSeries(10, 10, 0.6);
    const r = stopCriterion(series);
    expect(r.met).toBe(false);
    expect(r.reason).toContain('window not yet full');
    expect(r.relativeDrift).toBeNull();
  });

  it('returns a no-data result for an empty series', () => {
    const r = stopCriterion([]);
    expect(r.met).toBe(false);
    expect(r.relativeDrift).toBeNull();
    expect(r.windowSpanHrs).toBe(0);
  });

  it('respects custom window/threshold/min-soak config', () => {
    const series = flatSeries(80, 80, 0.6, 0.00005);
    // Tighter min-soak (60 h) and window (12 h) → now passes.
    const r = stopCriterion(series, { windowHrs: 12, minSoakHrs: 60, relThreshold: 0.005 });
    expect(r.met).toBe(true);
  });
});

describe('measurementUncertainty — GUM quadrature with k=2 expansion', () => {
  it('combines calibration and resolution components in quadrature', () => {
    const value = 0.6;
    const calRelStd = 0.002;
    const resolution = 0.001;
    const r = measurementUncertainty(value, { calRelStd, resolution, k: 2 });
    const uCal = calRelStd * value; // 0.0012
    const uRes = resolution / Math.sqrt(12);
    const expectedStd = Math.hypot(uCal, uRes);
    expect(r.standard).toBeCloseTo(expectedStd, 12);
    expect(r.expanded).toBeCloseTo(2 * expectedStd, 12);
    expect(r.k).toBe(2);
    expect(r.relative).toBeCloseTo((2 * expectedStd) / value, 12);
  });

  it('uses the IEC-referenced defaults when no config is passed', () => {
    const r = measurementUncertainty(0.6);
    const uCal = LETID_DARKV_CONSTANTS.CAL_REL_STD * 0.6;
    const uRes = LETID_DARKV_CONSTANTS.VOLT_RESOLUTION_V / Math.sqrt(12);
    expect(r.standard).toBeCloseTo(Math.hypot(uCal, uRes), 12);
    expect(r.k).toBe(LETID_DARKV_CONSTANTS.COVERAGE_K);
  });

  it('falls back to the resolution-only component at value 0 (relative is NaN)', () => {
    const r = measurementUncertainty(0, { calRelStd: 0.002, resolution: 0.001, k: 2 });
    expect(r.standard).toBeCloseTo(0.001 / Math.sqrt(12), 12);
    expect(r.expanded).toBeCloseTo((2 * 0.001) / Math.sqrt(12), 12);
    expect(Number.isNaN(r.relative)).toBe(true);
  });

  it('scales the calibration component with the magnitude of the reading', () => {
    const small = measurementUncertainty(0.5, { calRelStd: 0.002, resolution: 0 });
    const large = measurementUncertainty(50, { calRelStd: 0.002, resolution: 0 });
    // Pure calibration (no resolution) → expanded scales linearly with value.
    expect(large.expanded / small.expanded).toBeCloseTo(100, 9);
    expect(large.relative).toBeCloseTo(small.relative, 12);
  });
});
