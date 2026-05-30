/**
 * Vitest coverage for the Thermal Cycling extensions — IEC 61215-2 MQT 11.
 *
 * Every test maps to a clause / acceptance item so an audit can trace each
 * verdict back to the rule it enforces:
 *   • MQT 11 mounting / mass-loading  → validateMassLoadingKg
 *   • MQT 11.6.1 / 11.6.2 per-position tolerance → POSITION_TOLERANCES
 *   • MQT 11.6.2 instantaneous ramp   → pointToPointRampCph
 *   • MQT 11.6.2 averaged ramp        → cumulativeRampCph
 *   • SET-vs-ACTUAL verdict           → rampSetVsActual
 *
 * Mirrors backend/tests/test_tc_extensions_iec.py for two-sided parity.
 */
import { describe, it, expect } from 'vitest';
import {
  POSITION_TOLERANCES,
  MASS_LOADING_NOTE,
  positionToleranceSet,
  validateMassLoadingKg,
  pointToPointRampCph,
  cumulativeRampCph,
  classifyRampForPosition,
  rampSetVsActual,
  type ModulePosition,
} from './tcExtensions';
import type { LiveReading } from '@/types/test-session';

/** Helper — build a reading with only the fields the math touches. */
function r(timestamp: number, temperature: number | undefined): LiveReading {
  return { timestamp, voltage: 0, current: 0, power: 0, temperature };
}

describe('POSITION_TOLERANCES — per-position tolerance sets (MQT 11.6.1/11.6.2)', () => {
  const positions: ModulePosition[] = ['BIFACIAL', 'BSI', 'BNBI'];

  it('defines a tolerance set for every position with a clause ref', () => {
    for (const p of positions) {
      const t = POSITION_TOLERANCES[p];
      expect(t).toBeDefined();
      expect(t.clause).toMatch(/MQT 11\.6\./);
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.maxRampCph).toBeGreaterThan(0);
      expect(t.warnRampCph).toBeGreaterThanOrEqual(t.maxRampCph);
      expect(t.tempToleranceC).toBeGreaterThan(0);
    }
  });

  it('BIFACIAL uses the symmetric 100/120 °C/h baseline and ±2 °C', () => {
    const t = POSITION_TOLERANCES.BIFACIAL;
    expect(t.maxRampCph).toBe(100);
    expect(t.warnRampCph).toBe(120);
    expect(t.tempToleranceC).toBe(2);
  });

  it('BSI tightens the ramp to 90/110 °C/h (single-side illuminated)', () => {
    const t = POSITION_TOLERANCES.BSI;
    expect(t.maxRampCph).toBe(90);
    expect(t.warnRampCph).toBe(110);
    expect(t.tempToleranceC).toBe(2);
  });

  it('BNBI relaxes the plateau band to ±3 °C, ramp stays 100/120 °C/h', () => {
    const t = POSITION_TOLERANCES.BNBI;
    expect(t.maxRampCph).toBe(100);
    expect(t.warnRampCph).toBe(120);
    expect(t.tempToleranceC).toBe(3);
  });

  it('each position carries a DISTINCT tolerance set', () => {
    // BSI differs from BIFACIAL on ramp; BNBI differs on plateau band.
    expect(POSITION_TOLERANCES.BSI.maxRampCph).not.toBe(
      POSITION_TOLERANCES.BIFACIAL.maxRampCph,
    );
    expect(POSITION_TOLERANCES.BNBI.tempToleranceC).not.toBe(
      POSITION_TOLERANCES.BIFACIAL.tempToleranceC,
    );
  });
});

describe('positionToleranceSet', () => {
  it('returns the matching set for each known position', () => {
    expect(positionToleranceSet('BIFACIAL')).toBe(POSITION_TOLERANCES.BIFACIAL);
    expect(positionToleranceSet('BSI')).toBe(POSITION_TOLERANCES.BSI);
    expect(positionToleranceSet('BNBI')).toBe(POSITION_TOLERANCES.BNBI);
  });

  it('falls back to BIFACIAL for an unknown/legacy value', () => {
    // Cast through unknown — simulates a stale persisted config string.
    const stale = 'LEGACY' as unknown as ModulePosition;
    expect(positionToleranceSet(stale)).toBe(POSITION_TOLERANCES.BIFACIAL);
  });
});

describe('validateMassLoadingKg — MQT 11 mounting / mass-loading', () => {
  it('returns the value unchanged when positive', () => {
    expect(validateMassLoadingKg(2.5)).toBe(2.5);
    expect(validateMassLoadingKg(0.05)).toBe(0.05);
  });

  it('throws on zero', () => {
    expect(() => validateMassLoadingKg(0)).toThrow(RangeError);
  });

  it('throws on negative', () => {
    expect(() => validateMassLoadingKg(-1)).toThrow(RangeError);
  });

  it('throws on non-finite', () => {
    expect(() => validateMassLoadingKg(NaN)).toThrow(RangeError);
    expect(() => validateMassLoadingKg(Infinity)).toThrow(RangeError);
  });

  it('exposes a citable mass-loading note', () => {
    expect(MASS_LOADING_NOTE).toMatch(/MQT 11/);
    expect(MASS_LOADING_NOTE.toLowerCase()).toContain('mass');
  });
});

describe('pointToPointRampCph — instantaneous worst ramp (MQT 11.6.2)', () => {
  it('returns 0 for <2 usable samples', () => {
    expect(pointToPointRampCph([])).toBe(0);
    expect(pointToPointRampCph([r(0, 25)])).toBe(0);
  });

  it('computes the worst absolute consecutive-sample ramp', () => {
    // +1 °C in 36 s = 100 °C/h, then +2 °C in 36 s = 200 °C/h (worst).
    const readings = [r(0, 0), r(36_000, 1), r(72_000, 3)];
    expect(pointToPointRampCph(readings)).toBeCloseTo(200, 5);
  });

  it('is sign-agnostic (cooling counts as a positive ramp magnitude)', () => {
    // −1 °C in 36 s → magnitude 100 °C/h.
    const readings = [r(0, 0), r(36_000, -1)];
    expect(pointToPointRampCph(readings)).toBeCloseTo(100, 5);
  });

  it('skips non-advancing-time and undefined-temp consecutive pairs', () => {
    // Pairs: (0→0 dt=0 skip) (0→undef skip) (undef→1 skip) — no usable
    // consecutive pair remains, so the worst ramp is 0.
    const readings = [r(0, 0), r(0, 5), r(36_000, undefined), r(72_000, 1)];
    expect(pointToPointRampCph(readings)).toBe(0);
  });

  it('only compares CONSECUTIVE samples (does not bridge a gap)', () => {
    // A fast 100 °C/h pair surrounded by valid samples is found; the
    // function never pairs non-adjacent indices.
    const readings = [r(0, 0), r(36_000, 1), r(360_000, 1)];
    // (0→1 in 36 s = 100 °C/h) then (1→1 over 324 s = 0) → worst 100.
    expect(pointToPointRampCph(readings)).toBeCloseTo(100, 5);
  });
});

describe('cumulativeRampCph — run-averaged ramp (MQT 11.6.2)', () => {
  it('returns 0 for <2 usable samples', () => {
    expect(cumulativeRampCph([])).toBe(0);
    expect(cumulativeRampCph([r(0, 25)])).toBe(0);
  });

  it('averages total |ΔT| over total elapsed time', () => {
    // +1 °C over 36 s then +1 °C over 36 s = 2 °C over 72 s = 100 °C/h.
    const readings = [r(0, 0), r(36_000, 1), r(72_000, 2)];
    expect(cumulativeRampCph(readings)).toBeCloseTo(100, 5);
  });

  it('sums absolute travel so a there-and-back run is non-zero', () => {
    // 0→1→0 °C over 72 s = 2 °C of |travel| / 0.02 h = 100 °C/h.
    const readings = [r(0, 0), r(36_000, 1), r(72_000, 0)];
    expect(cumulativeRampCph(readings)).toBeCloseTo(100, 5);
  });

  it('differs from point-to-point when one excursion is faster', () => {
    // slow 50 °C/h then fast 150 °C/h → p2p=150, cumulative between the two.
    const readings = [r(0, 0), r(72_000, 1), r(108_000, 2.5)];
    const p2p = pointToPointRampCph(readings);
    const cum = cumulativeRampCph(readings);
    expect(p2p).toBeCloseTo(150, 5);
    expect(cum).toBeGreaterThan(0);
    expect(cum).toBeLessThan(p2p);
  });
});

describe('classifyRampForPosition', () => {
  it('passes at/below max, warns up to warn ceiling, fails above', () => {
    const tol = POSITION_TOLERANCES.BSI; // 90 / 110
    expect(classifyRampForPosition(89, tol)).toBe('pass');
    expect(classifyRampForPosition(90, tol)).toBe('pass');
    expect(classifyRampForPosition(95, tol)).toBe('warn');
    expect(classifyRampForPosition(110, tol)).toBe('warn');
    expect(classifyRampForPosition(111, tol)).toBe('fail');
  });

  it('the SAME ramp can pass BIFACIAL yet warn under the stricter BSI', () => {
    const ramp = 95; // ≤100 (BIFACIAL pass) but >90 (BSI warn)
    expect(classifyRampForPosition(ramp, POSITION_TOLERANCES.BIFACIAL)).toBe('pass');
    expect(classifyRampForPosition(ramp, POSITION_TOLERANCES.BSI)).toBe('warn');
  });
});

describe('rampSetVsActual — SET vs ACTUAL for both flavours', () => {
  it('is pending with no usable telemetry', () => {
    const cmp = rampSetVsActual([], { rampRateCph: 100, position: 'BIFACIAL' });
    expect(cmp.verdict).toBe('pending');
    expect(cmp.pointToPoint.actualCph).toBe(0);
    expect(cmp.cumulative.actualCph).toBe(0);
    expect(cmp.tolerance).toBe(POSITION_TOLERANCES.BIFACIAL);
  });

  it('reports set, actual and signed delta for both ramps', () => {
    // worst p2p = 200 °C/h, cumulative = 100 °C/h, set = 90 °C/h.
    const readings = [r(0, 0), r(36_000, 1), r(72_000, 3)];
    const cmp = rampSetVsActual(readings, { rampRateCph: 90, position: 'BIFACIAL' });
    expect(cmp.pointToPoint.setCph).toBe(90);
    expect(cmp.pointToPoint.actualCph).toBeCloseTo(200, 5);
    expect(cmp.pointToPoint.deltaCph).toBeCloseTo(110, 5);
    expect(cmp.cumulative.actualCph).toBeCloseTo(150, 5);
    expect(cmp.cumulative.deltaCph).toBeCloseTo(60, 5);
  });

  it('verdict is driven by the point-to-point ramp + selected position', () => {
    // Instantaneous 95 °C/h: pass under BIFACIAL (≤100), warn under BSI (>90).
    const readings = [r(0, 0), r(36_000, 0.95)]; // 0.95 °C / 0.01 h = 95 °C/h
    const bif = rampSetVsActual(readings, { rampRateCph: 100, position: 'BIFACIAL' });
    const bsi = rampSetVsActual(readings, { rampRateCph: 100, position: 'BSI' });
    expect(bif.pointToPoint.actualCph).toBeCloseTo(95, 5);
    expect(bif.verdict).toBe('pass');
    expect(bsi.verdict).toBe('warn');
    expect(bsi.tolerance.clause).toMatch(/BSI/);
  });

  it('fails when the instantaneous ramp exceeds the warn ceiling', () => {
    // 200 °C/h > 120 (BIFACIAL warn ceiling) → fail.
    const readings = [r(0, 0), r(36_000, 2)];
    const cmp = rampSetVsActual(readings, { rampRateCph: 100, position: 'BIFACIAL' });
    expect(cmp.verdict).toBe('fail');
  });
});
