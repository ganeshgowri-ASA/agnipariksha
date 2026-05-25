import { describe, it, expect } from 'vitest';
import {
  linearFit,
  extrapolateVAtT,
  judgeDiode,
  judgeModule,
  type DiodePoint,
} from './regression';
import { DEMO_DIODES } from './demoData';

describe('linearFit — Mitsui R.MQT18.1v01 example (V_D = -0.0011·T_j + 0.4558)', () => {
  for (const diode of DEMO_DIODES) {
    it(`${diode.diodeId}: recovers slope, intercept and R²`, () => {
      const fit = linearFit(diode.points);
      // slope ≈ -1.1e-3 V/°C, intercept ≈ 0.4558 V, near-perfect linear fit.
      expect(fit.slope).toBeCloseTo(-0.0011, 3);
      expect(fit.intercept).toBeCloseTo(0.4558, 2);
      expect(fit.r2).toBeGreaterThan(0.99);
      expect(fit.n).toBe(diode.points.length);
    });
  }

  it('extrapolates V_D to T_jmax along the fitted line', () => {
    const fit = linearFit(DEMO_DIODES[0].points);
    expect(extrapolateVAtT(fit, 0)).toBeCloseTo(fit.intercept, 10);
    // ~200 °C extrapolation stays a physically sane forward drop (~0.25 V).
    expect(extrapolateVAtT(fit, 200)).toBeCloseTo(fit.slope * 200 + fit.intercept, 10);
    expect(extrapolateVAtT(fit, 200)).toBeGreaterThan(0.2);
    expect(extrapolateVAtT(fit, 200)).toBeLessThan(0.3);
  });

  it('judges every demo diode PASS (strong fit, drop within band)', () => {
    for (const d of DEMO_DIODES) {
      const j = judgeDiode(d.diodeId, d.points, d.tjmaxc);
      expect(j.verdict).toBe('PASS');
    }
  });
});

describe('judgeDiode — verdict thresholds', () => {
  it('REVIEW on a noisy, weak fit (0.5 ≤ R² < 0.85)', () => {
    const noisy: DiodePoint[] = [
      { tjc: 25, vdropv: 0.46 },
      { tjc: 40, vdropv: 0.40 },
      { tjc: 55, vdropv: 0.44 },
      { tjc: 70, vdropv: 0.41 },
      { tjc: 85, vdropv: 0.37 },
    ];
    const fit = linearFit(noisy);
    expect(fit.r2).toBeGreaterThanOrEqual(0.5);
    expect(fit.r2).toBeLessThan(0.85);

    const j = judgeDiode('noisy', noisy, 200);
    expect(j.verdict).toBe('REVIEW');
  });

  it('FAIL when R² < 0.5 (no usable characteristic)', () => {
    const scatter: DiodePoint[] = [
      { tjc: 30, vdropv: 0.40 },
      { tjc: 40, vdropv: 0.44 },
      { tjc: 50, vdropv: 0.39 },
      { tjc: 60, vdropv: 0.45 },
      { tjc: 70, vdropv: 0.40 },
    ];
    expect(linearFit(scatter).r2).toBeLessThan(0.5);
    expect(judgeDiode('scatter', scatter, 200).verdict).toBe('FAIL');
  });

  it('REVIEW when the fit is strong but |V_D(T_jmax)| leaves the safe band', () => {
    // Clean line, but a tiny safe band forces the extrapolated drop out of range.
    const j = judgeDiode('strong', DEMO_DIODES[0].points, 200, 0.1);
    expect(j.fit.r2).toBeGreaterThan(0.99);
    expect(j.verdict).toBe('REVIEW');
  });
});

describe('judgeModule — worst-of-all-diodes', () => {
  it('takes the worst verdict (FAIL dominates)', () => {
    expect(judgeModule([{ verdict: 'PASS' }, { verdict: 'REVIEW' }, { verdict: 'FAIL' }])).toBe('FAIL');
  });

  it('returns REVIEW when the worst is REVIEW', () => {
    expect(judgeModule([{ verdict: 'PASS' }, { verdict: 'REVIEW' }, { verdict: 'PASS' }])).toBe('REVIEW');
  });

  it('returns PASS only when all diodes PASS', () => {
    expect(judgeModule([{ verdict: 'PASS' }, { verdict: 'PASS' }])).toBe('PASS');
  });

  it('derives the module verdict from real per-diode judgements', () => {
    const perDiode = DEMO_DIODES.map((d) => judgeDiode(d.diodeId, d.points, d.tjmaxc));
    expect(judgeModule(perDiode)).toBe('PASS');

    // Degrade one diode and the module follows the worst.
    const degraded = [...perDiode, judgeDiode('bad', [{ tjc: 30, vdropv: 0.4 }, { tjc: 60, vdropv: 0.41 }, { tjc: 90, vdropv: 0.39 }], 200)];
    expect(judgeModule(degraded)).not.toBe('PASS');
  });
});
