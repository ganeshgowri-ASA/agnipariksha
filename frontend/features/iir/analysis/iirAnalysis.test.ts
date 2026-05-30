/**
 * Vitest coverage for Inverted IR analysis (IEC TS 60904-12).
 */
import { describe, it, expect } from 'vitest';
import { computeIirKpis, IIR_CONSTANTS, type IirConfig } from './iirAnalysis';

const cfg: IirConfig = {
  threshold: 10,
  forwardCurrent: 4.5,
};

function uniformGrid(cols: number, rows: number, value: number): number[] {
  return new Array(cols * rows).fill(value);
}

describe('computeIirKpis — empty', () => {
  it('returns pending defaults', () => {
    const k = computeIirKpis([], 0, cfg);
    expect(k.overallVerdict).toBe('pending');
    expect(k.tMedian).toBe(0);
  });
});

describe('computeIirKpis — uniform grid', () => {
  it('all metrics derive correctly', () => {
    const k = computeIirKpis(uniformGrid(64, 32, 30), 64, cfg);
    expect(k.tMedian).toBe(30);
    expect(k.tMax).toBe(30);
    expect(k.tMin).toBe(30);
    expect(k.maxDeltaT).toBe(0);
    expect(k.hotSpots.length).toBe(0);
    expect(k.hotspotVerdict).toBe('pass');
  });
});

describe('computeIirKpis — hotspot detection', () => {
  it('PASS when max ΔT ≤ 10 °C', () => {
    const t = uniformGrid(64, 32, 30);
    t[100] = 38;  // +8 °C
    const k = computeIirKpis(t, 64, cfg);
    expect(k.hotspotVerdict).toBe('pass');
    expect(k.hotSpots.length).toBe(0); // below operator threshold
  });

  it('WARN at 10-20 °C max ΔT', () => {
    const t = uniformGrid(64, 32, 30);
    t[100] = 45;  // +15 °C
    const k = computeIirKpis(t, 64, cfg);
    expect(k.hotspotVerdict).toBe('warn');
    expect(k.maxDeltaT).toBe(15);
    expect(k.hotSpots.length).toBe(1);
    expect(k.hotSpots[0].deltaT).toBe(15);
  });

  it('FAIL above 20 °C max ΔT', () => {
    const t = uniformGrid(64, 32, 30);
    t[100] = 55;  // +25 °C
    expect(computeIirKpis(t, 64, cfg).hotspotVerdict).toBe('fail');
  });
});

describe('computeIirKpis — hotspot table', () => {
  it('lists cells above operator threshold sorted by ΔT', () => {
    const t = uniformGrid(64, 32, 30);
    t[10] = 50;
    t[20] = 42;
    t[30] = 60;
    const k = computeIirKpis(t, 64, cfg);
    expect(k.hotSpots.length).toBe(3);
    expect(k.hotSpots[0].idx).toBe(30); // hottest first
    expect(k.hotSpots[1].idx).toBe(10);
    expect(k.hotSpots[2].idx).toBe(20);
  });

  it('row/col coordinates correctly decoded', () => {
    const t = uniformGrid(64, 32, 30);
    t[64 + 5] = 50; // row=1, col=5
    const k = computeIirKpis(t, 64, cfg);
    expect(k.hotSpots[0].row).toBe(1);
    expect(k.hotSpots[0].col).toBe(5);
  });
});

describe('computeIirKpis — warm cells counter', () => {
  it('counts cells > 5 °C above median (info, not verdict)', () => {
    const t = uniformGrid(64, 32, 30);
    [0, 1, 2].forEach(i => { t[i] = 36; }); // +6 °C
    const k = computeIirKpis(t, 64, cfg);
    expect(k.warmCells).toBe(3);
    // ΔT of 6 is below the operator threshold (10) so no hotspots flagged
    expect(k.hotSpots.length).toBe(0);
  });
});

describe('computeIirKpis — threshold honored', () => {
  it('operator-set threshold drives the hotspot table', () => {
    const t = uniformGrid(64, 32, 30);
    t[5] = 38; // +8 °C
    const looser = computeIirKpis(t, 64, { ...cfg, threshold: 5 });
    expect(looser.hotSpots.length).toBe(1);
    const stricter = computeIirKpis(t, 64, { ...cfg, threshold: 15 });
    expect(stricter.hotSpots.length).toBe(0);
  });
});
