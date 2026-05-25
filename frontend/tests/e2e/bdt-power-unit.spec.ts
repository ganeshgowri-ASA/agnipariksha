import { test, expect } from '@playwright/test';
import { buildLiveSample } from '../../lib/bdt/liveSample';

// Pure-logic guard for the BDT Live Monitor 1000x power-unit bug:
// 50.33 V * 11.44 A used to render as 0.58 W instead of 575.77 W.
test.describe('buildLiveSample power unit', () => {
  test('power_w equals V*I in watts', () => {
    const expected = 575.77;
    const { power_w } = buildLiveSample(50.33, 11.44, 72.4);
    expect(Math.abs(power_w - expected) / expected).toBeLessThan(0.001);
  });

  test('power_w stays above 1 W for typical BDT operating points', () => {
    expect(buildLiveSample(50.33, 11.44, 72.4).power_w).toBeGreaterThan(1);
    expect(buildLiveSample(12, 15).power_w).toBeGreaterThan(1);
  });
});
