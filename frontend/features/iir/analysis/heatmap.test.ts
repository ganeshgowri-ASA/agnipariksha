/**
 * Vitest coverage for the IR thermography heatmap helpers (IEC TS 60904-12).
 * Mirrors backend/tests/test_ir_thermography_iec.py — keep the two in sync.
 */
import { describe, it, expect } from 'vitest';
import {
  gridStats,
  hotspotCells,
  histogram,
  colorScale,
  HEATMAP_CONSTANTS,
  type TempGrid,
} from './heatmap';

// A known 3×3 grid: values 10..90 step 10.
const KNOWN: TempGrid = [
  [10, 20, 30],
  [40, 50, 60],
  [70, 80, 90],
];

function uniformGrid(rows: number, cols: number, value: number): number[][] {
  return Array.from({ length: rows }, () => new Array(cols).fill(value));
}

describe('gridStats', () => {
  it('computes min/max/mean/std on a known grid', () => {
    const s = gridStats(KNOWN);
    expect(s.min).toBe(10);
    expect(s.max).toBe(90);
    expect(s.mean).toBe(50);
    expect(s.count).toBe(9);
    // population std of 10..90 step 10 = sqrt(6000/9) ≈ 25.8199
    expect(s.std).toBeCloseTo(25.8199, 3);
  });

  it('returns zeroed stats for an empty grid', () => {
    const s = gridStats([]);
    expect(s).toEqual({ min: 0, max: 0, mean: 0, std: 0, count: 0 });
  });

  it('zero std for a uniform grid', () => {
    const s = gridStats(uniformGrid(4, 4, 42));
    expect(s.mean).toBe(42);
    expect(s.std).toBe(0);
    expect(s.count).toBe(16);
  });
});

describe('hotspotCells', () => {
  it('flags cells exceeding mean + ΔT, sorted hottest-first', () => {
    // mean is 50; with ΔT=10 the threshold is >60 → cells 70/80/90.
    const cells = hotspotCells(KNOWN, 10);
    expect(cells.length).toBe(3);
    expect(cells[0].temp).toBe(90); // hottest first
    expect(cells[1].temp).toBe(80);
    expect(cells[2].temp).toBe(70);
    expect(cells[0].deltaT).toBe(40); // 90 - 50
    expect(cells[0]).toMatchObject({ row: 2, col: 2 });
  });

  it('defaults to the IEC TS 60904-12 hot-spot threshold', () => {
    const withDefault = hotspotCells(KNOWN);
    const explicit = hotspotCells(KNOWN, HEATMAP_CONSTANTS.HOTSPOT_DELTA_T_C);
    expect(withDefault).toEqual(explicit);
  });

  it('flags nothing on a uniform grid', () => {
    expect(hotspotCells(uniformGrid(5, 5, 30), 1)).toEqual([]);
  });

  it('honors a stricter threshold', () => {
    // ΔT=35 → only cells >85 → just 90.
    const cells = hotspotCells(KNOWN, 35);
    expect(cells.length).toBe(1);
    expect(cells[0].temp).toBe(90);
  });
});

describe('histogram', () => {
  it('bins the grid and the counts sum to the cell count', () => {
    const bins = histogram(KNOWN, 4);
    expect(bins.length).toBe(4);
    const total = bins.reduce((acc, b) => acc + b.count, 0);
    expect(total).toBe(9); // every cell counted exactly once
    // First bin starts at min, last bin ends at max.
    expect(bins[0].start).toBe(10);
    expect(bins[bins.length - 1].end).toBe(90);
  });

  it('collapses an all-equal grid into a single populated bin', () => {
    const bins = histogram(uniformGrid(3, 3, 25), 8);
    expect(bins.length).toBe(1);
    expect(bins[0].count).toBe(9);
    expect(bins[0].start).toBe(25);
    expect(bins[0].end).toBe(25);
  });

  it('puts the max value in the last bin (inclusive right edge)', () => {
    const bins = histogram(KNOWN, 9);
    const total = bins.reduce((acc, b) => acc + b.count, 0);
    expect(total).toBe(9);
    expect(bins[bins.length - 1].count).toBeGreaterThanOrEqual(1); // 90 lands here
  });

  it('clamps a non-positive bin count to 1', () => {
    const bins = histogram(KNOWN, 0);
    expect(bins.length).toBe(1);
    expect(bins[0].count).toBe(9);
  });

  it('returns no bins for an empty grid', () => {
    expect(histogram([], 8)).toEqual([]);
  });
});

describe('colorScale', () => {
  it('maps endpoints and midpoint of the range', () => {
    expect(colorScale(0, 0, 100)).toBe(0);
    expect(colorScale(50, 0, 100)).toBe(0.5);
    expect(colorScale(100, 0, 100)).toBe(1);
  });

  it('clamps out-of-range values', () => {
    expect(colorScale(-10, 0, 100)).toBe(0);
    expect(colorScale(150, 0, 100)).toBe(1);
  });

  it('maps a zero-width range to 0', () => {
    expect(colorScale(42, 42, 42)).toBe(0);
  });
});
