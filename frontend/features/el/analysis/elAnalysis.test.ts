/**
 * Vitest coverage for EL analysis (IEC TS 60904-13).
 */
import { describe, it, expect } from 'vitest';
import {
  computeElKpis, generateDemoFrame, EL_CONSTANTS, type ElFrame,
} from './elAnalysis';

function uniformFrame(cellsX: number, cellsY: number, value: number): ElFrame {
  return {
    cellsX, cellsY,
    intensities: new Array(cellsX * cellsY).fill(value),
    injectionCurrent: 9,
    exposureSec: 10,
    capturedAtMs: 0,
  };
}

describe('computeElKpis — empty / null', () => {
  it('returns pending defaults for null frame', () => {
    const k = computeElKpis(null);
    expect(k.overallVerdict).toBe('pending');
    expect(k.meanIntensity).toBe(0);
  });

  it('returns pending defaults for empty frame', () => {
    const k = computeElKpis({ cellsX: 0, cellsY: 0, intensities: [], injectionCurrent: 0, exposureSec: 0, capturedAtMs: 0 });
    expect(k.overallVerdict).toBe('pending');
  });
});

describe('computeElKpis — mean intensity verdict', () => {
  it('PASS when mean ≥ 0.45', () => {
    const k = computeElKpis(uniformFrame(6, 10, 0.55));
    expect(k.meanIntensityVerdict).toBe('pass');
  });

  it('WARN at 0.80 × min', () => {
    const k = computeElKpis(uniformFrame(6, 10, 0.40));
    expect(k.meanIntensityVerdict).toBe('warn');
  });

  it('FAIL well below min', () => {
    const k = computeElKpis(uniformFrame(6, 10, 0.20));
    expect(k.meanIntensityVerdict).toBe('fail');
  });
});

describe('computeElKpis — inactive cells', () => {
  it('detects an inactive cell (intensity below 30% of mean)', () => {
    // Uniform 0.5 frame with one dead cell at 0.05
    const f: ElFrame = uniformFrame(4, 4, 0.5);
    f.intensities[5] = 0.05;
    const k = computeElKpis(f);
    expect(k.inactiveCells).toBe(1);
    expect(k.inactiveIdx).toContain(5);
  });

  it('PASS when ≤2% inactive', () => {
    // 60-cell frame with 1 dead cell = 1.67% → pass
    const f: ElFrame = uniformFrame(6, 10, 0.6);
    f.intensities[10] = 0.05;
    expect(computeElKpis(f).inactiveVerdict).toBe('pass');
  });

  it('FAIL at >5% inactive', () => {
    // 60-cell frame with 5 dead cells = 8.3% → fail
    const f: ElFrame = uniformFrame(6, 10, 0.6);
    [0, 5, 10, 15, 20].forEach(i => { f.intensities[i] = 0.02; });
    expect(computeElKpis(f).inactiveVerdict).toBe('fail');
  });
});

describe('computeElKpis — defect detection (gradient)', () => {
  it('uniform frame has zero defects', () => {
    const k = computeElKpis(uniformFrame(6, 10, 0.5));
    expect(k.defectCells).toBe(0);
  });

  it('a sharp intensity drop is detected as a defect', () => {
    const f = uniformFrame(6, 10, 0.6);
    // create a step: cell (1,3)=0.6 -> (2,3)=0.05 → gradient 0.55 > threshold 0.18
    f.intensities[3 * 6 + 2] = 0.05;
    const k = computeElKpis(f);
    expect(k.defectCells).toBeGreaterThan(0);
  });
});

describe('computeElKpis — composite verdict', () => {
  it('overall PASS for healthy uniform frame', () => {
    expect(computeElKpis(uniformFrame(6, 10, 0.6)).overallVerdict).toBe('pass');
  });

  it('overall FAIL when many cells inactive', () => {
    const f = uniformFrame(6, 10, 0.6);
    for (let i = 0; i < 10; i++) f.intensities[i] = 0.02;
    expect(computeElKpis(f).overallVerdict).toBe('fail');
  });
});

describe('generateDemoFrame', () => {
  it('produces a 6x10 frame deterministically', () => {
    const a = generateDemoFrame(6, 10, 9.0);
    const b = generateDemoFrame(6, 10, 9.0);
    expect(a.intensities).toEqual(b.intensities);
    expect(a.intensities.length).toBe(60);
  });

  it('different injection currents produce different frames', () => {
    const a = generateDemoFrame(6, 10, 9.0);
    const b = generateDemoFrame(6, 10, 5.0);
    expect(a.intensities).not.toEqual(b.intensities);
  });

  it('demo frame has at least one inactive cell baked in', () => {
    const frame = generateDemoFrame(6, 10, 9.0);
    const kpis = computeElKpis(frame);
    expect(kpis.inactiveCells).toBeGreaterThanOrEqual(1);
  });
});
