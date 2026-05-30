/**
 * Vitest coverage for the dual-path Ground/Equipotential continuity math
 * (IEC 61730-2 MST 13).
 *
 * Every case maps to an MST 13 acceptance criterion so a future audit can
 * trace each verdict to the rule it enforces. The same boundaries are
 * pinned on the backend in backend/tests/test_gc_dual_path_iec.py — the two
 * MUST agree.
 */
import { describe, it, expect } from 'vitest';
import {
  pathResistanceVerdict,
  frameCurrentInBand,
  dualPathVerdict,
  DUAL_PATH_CONSTANTS,
  FRAME_CURRENT_MIN_A,
  FRAME_CURRENT_MAX_A,
  GC_CONTEXTS,
  GC_CONTEXT_LABELS,
  type GcContext,
} from './dualPath';

describe('pathResistanceVerdict — MST 13 limit (R < 0.1 Ω)', () => {
  it('grades resistance below the limit as conform', () => {
    expect(pathResistanceVerdict(0.0)).toBe('conform');
    expect(pathResistanceVerdict(0.042)).toBe('conform');
    expect(pathResistanceVerdict(0.099)).toBe('conform');
  });

  it('grades the 0.1 Ω boundary as non-conform (strictly less-than)', () => {
    expect(pathResistanceVerdict(DUAL_PATH_CONSTANTS.MST13_MAX_R_OHM)).toBe('non-conform');
    expect(pathResistanceVerdict(0.1)).toBe('non-conform');
  });

  it('grades resistance above the limit as non-conform', () => {
    expect(pathResistanceVerdict(0.1001)).toBe('non-conform');
    expect(pathResistanceVerdict(0.5)).toBe('non-conform');
  });

  it('treats impossible / missing readings as non-conform', () => {
    expect(pathResistanceVerdict(-0.01)).toBe('non-conform');
    expect(pathResistanceVerdict(Number.NaN)).toBe('non-conform');
    expect(pathResistanceVerdict(Number.POSITIVE_INFINITY)).toBe('non-conform');
  });
});

describe('frameCurrentInBand — ±band around 25 A nominal (MST 13)', () => {
  it('exposes the band derived from the nominal + tolerance', () => {
    // 25 A ± 10% → [22.5, 27.5]
    expect(FRAME_CURRENT_MIN_A).toBeCloseTo(22.5, 6);
    expect(FRAME_CURRENT_MAX_A).toBeCloseTo(27.5, 6);
  });

  it('accepts the nominal and values inside the band (inclusive endpoints)', () => {
    expect(frameCurrentInBand(DUAL_PATH_CONSTANTS.NOMINAL_FRAME_CURRENT_A)).toBe(true);
    expect(frameCurrentInBand(25)).toBe(true);
    expect(frameCurrentInBand(FRAME_CURRENT_MIN_A)).toBe(true);
    expect(frameCurrentInBand(FRAME_CURRENT_MAX_A)).toBe(true);
  });

  it('rejects values just outside the band', () => {
    expect(frameCurrentInBand(FRAME_CURRENT_MIN_A - 0.01)).toBe(false);
    expect(frameCurrentInBand(FRAME_CURRENT_MAX_A + 0.01)).toBe(false);
    expect(frameCurrentInBand(0)).toBe(false);
    expect(frameCurrentInBand(40)).toBe(false);
  });

  it('rejects non-finite currents', () => {
    expect(frameCurrentInBand(Number.NaN)).toBe(false);
    expect(frameCurrentInBand(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('dualPathVerdict — overall MST 13 conformity', () => {
  it('is pending until both paths and the injected current are present', () => {
    expect(dualPathVerdict({ shortestR: null, longestR: null, injectedA: null })).toBe('pending');
    expect(dualPathVerdict({ shortestR: 0.04, longestR: null, injectedA: 25 })).toBe('pending');
    expect(dualPathVerdict({ shortestR: 0.04, longestR: 0.08, injectedA: null })).toBe('pending');
    expect(dualPathVerdict({ shortestR: null, longestR: 0.08, injectedA: 25 })).toBe('pending');
  });

  it('is conform when BOTH paths are below the limit and current is in band', () => {
    expect(dualPathVerdict({ shortestR: 0.038, longestR: 0.094, injectedA: 25 })).toBe('conform');
    expect(dualPathVerdict({ shortestR: 0.099, longestR: 0.099, injectedA: 27.5 })).toBe('conform');
  });

  it('is non-conform when the LONGEST path reaches/exceeds the limit', () => {
    expect(dualPathVerdict({ shortestR: 0.04, longestR: 0.1, injectedA: 25 })).toBe('non-conform');
    expect(dualPathVerdict({ shortestR: 0.04, longestR: 0.25, injectedA: 25 })).toBe('non-conform');
  });

  it('is non-conform when the SHORTEST path reaches/exceeds the limit', () => {
    expect(dualPathVerdict({ shortestR: 0.1, longestR: 0.05, injectedA: 25 })).toBe('non-conform');
  });

  it('is non-conform when the injected current is out of band, even if both paths pass', () => {
    expect(dualPathVerdict({ shortestR: 0.04, longestR: 0.08, injectedA: 10 })).toBe('non-conform');
    expect(dualPathVerdict({ shortestR: 0.04, longestR: 0.08, injectedA: 30 })).toBe('non-conform');
  });
});

describe('GC context label passthrough', () => {
  it('exposes exactly the four cross-cutting contexts in display order', () => {
    expect(GC_CONTEXTS).toEqual(['COP', 'DPTT', 'LeTID', 'IDD']);
  });

  it('maps every context to a human-readable label', () => {
    for (const ctx of GC_CONTEXTS) {
      expect(typeof GC_CONTEXT_LABELS[ctx]).toBe('string');
      expect(GC_CONTEXT_LABELS[ctx].length).toBeGreaterThan(0);
    }
    const idd: GcContext = 'IDD';
    expect(GC_CONTEXT_LABELS[idd]).toMatch(/Insulation/);
  });
});
