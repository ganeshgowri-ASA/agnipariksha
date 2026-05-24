import { test, expect } from '@playwright/test';
import {
  linearRegression, extrapolateVdrop, diodeVerdict, moduleVerdict, analyseDiodes,
  SAFE_VD_BAND_V, type VdTjPoint,
} from '../lib/bdt-regression';

/**
 * P3 — BDT MQT 18.1 V_drop-vs-T_j linear regression.
 *
 * These are pure-function unit tests; they never touch the page, so they run
 * under the existing Playwright harness without server interaction.
 */

// Reproduces the Mitsui BDT Excel template fit: y = -0.0011x + 0.4558.
function mitsuiPoints(): VdTjPoint[] {
  const tjs = [25, 40, 55, 70, 85, 100, 115, 130, 145, 160, 175];
  return tjs.map(tj => ({ tj, vdrop: -0.0011 * tj + 0.4558 }));
}

test('linearRegression recovers the Mitsui template fit (-0.0011x + 0.4558)', () => {
  const fit = linearRegression(mitsuiPoints());
  expect(fit.slope).toBeCloseTo(-0.0011, 6);
  expect(fit.intercept).toBeCloseTo(0.4558, 6);
  expect(fit.rSquared).toBeGreaterThan(0.99);
});

test('linearRegression tolerates noise yet keeps slope/intercept near target', () => {
  // Deterministic ±2 mV zig-zag so R² stays high but < 1.
  const noise = [0.002, -0.002, 0.0015, -0.0015, 0.001, -0.001, 0.0018, -0.0018, 0.0012, -0.0012, 0];
  const pts = mitsuiPoints().map((p, i) => ({ tj: p.tj, vdrop: p.vdrop + noise[i] }));
  const fit = linearRegression(pts);
  expect(fit.slope).toBeCloseTo(-0.0011, 3);
  expect(fit.intercept).toBeCloseTo(0.4558, 2);
  expect(fit.rSquared).toBeGreaterThan(0.95);
  expect(fit.rSquared).toBeLessThanOrEqual(1);
});

test('linearRegression handles degenerate input without NaN', () => {
  expect(linearRegression([])).toEqual({ slope: 0, intercept: 0, rSquared: 0 });
  expect(linearRegression([{ tj: 50, vdrop: 0.4 }])).toEqual({ slope: 0, intercept: 0.4, rSquared: 0 });
  // Zero x-variance → slope undefined, return mean as intercept.
  const flat = linearRegression([{ tj: 50, vdrop: 0.4 }, { tj: 50, vdrop: 0.6 }]);
  expect(flat.slope).toBe(0);
  expect(flat.intercept).toBeCloseTo(0.5, 6);
});

test('extrapolateVdrop evaluates the fit at Tjmax', () => {
  const fit = linearRegression(mitsuiPoints());
  // -0.0011 * 175 + 0.4558 = 0.2633
  expect(extrapolateVdrop(fit, 175)).toBeCloseTo(0.2633, 4);
});

test('diodeVerdict applies the R² and safe-band thresholds', () => {
  expect(diodeVerdict(0.99, 0.26)).toBe('PASS');          // high R², in band
  expect(diodeVerdict(0.99, 0.9)).toBe('REVIEW');          // high R², out of band
  expect(diodeVerdict(0.7, 0.26)).toBe('REVIEW');          // mid R²
  expect(diodeVerdict(0.3, 0.26)).toBe('FAIL');            // low R²
  expect(diodeVerdict(0.99, SAFE_VD_BAND_V)).toBe('PASS'); // exactly at band edge
});

test('moduleVerdict takes the worst-case diode verdict', () => {
  expect(moduleVerdict(['PASS', 'PASS'])).toBe('PASS');
  expect(moduleVerdict(['PASS', 'REVIEW'])).toBe('REVIEW');
  expect(moduleVerdict(['REVIEW', 'FAIL', 'PASS'])).toBe('FAIL');
  expect(moduleVerdict([])).toBe('PASS');
});

test('analyseDiodes returns per-diode fits and a rolled-up module verdict', () => {
  const good = mitsuiPoints();
  const bad: VdTjPoint[] = [
    { tj: 25, vdrop: 0.2 }, { tj: 50, vdrop: 0.9 }, { tj: 75, vdrop: 0.1 }, { tj: 100, vdrop: 0.8 },
  ];
  const { diodes, module } = analyseDiodes(
    [{ diodeId: 'D1', points: good }, { diodeId: 'D2', points: bad }],
    175,
  );
  expect(diodes).toHaveLength(2);
  expect(diodes[0].verdict).toBe('PASS');
  expect(diodes[1].fit.rSquared).toBeLessThan(0.5);
  expect(diodes[1].verdict).toBe('FAIL');
  expect(module).toBe('FAIL');
});
