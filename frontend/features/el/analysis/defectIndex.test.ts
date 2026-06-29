/**
 * Vitest coverage for the EL DEFECT INDEX
 * (IEC TS 60904-13 + IEA PVPS Task 13 defect catalogue).
 *
 * Pins the index math, every A/B/C classification boundary, and the
 * DEFAULT-vs-MBJ threshold-set differences. The same cases are mirrored
 * in backend/tests/test_el_defect_index_iec.py so the two stay in sync.
 */
import { describe, it, expect } from 'vitest';
import {
  computeDefectIndex,
  classifyDefectIndex,
  describeGrade,
  DEFECT_WEIGHTS,
  DEFECT_INDEX_NORM,
  DEFECT_THRESHOLDS,
  type DefectInput,
} from './defectIndex';

function input(p: Partial<DefectInput>): DefectInput {
  return { classA: 0, classB: 0, classC: 0, areaFraction: 0, ...p };
}

describe('computeDefectIndex — boundaries & math', () => {
  it('pristine module scores 0', () => {
    expect(computeDefectIndex(input({})).index).toBe(0);
  });

  it('weighted score sums A·1 + B·5 + C·15', () => {
    const r = computeDefectIndex(input({ classA: 2, classB: 1, classC: 1 }));
    // 2*1 + 1*5 + 1*15 = 22
    expect(r.weightedScore).toBe(22);
    expect(DEFECT_WEIGHTS.A).toBe(1);
    expect(DEFECT_WEIGHTS.B).toBe(5);
    expect(DEFECT_WEIGHTS.C).toBe(15);
  });

  it('area term maps linearly: 40 × areaFraction with zero counts', () => {
    expect(computeDefectIndex(input({ areaFraction: 0.5 })).index).toBeCloseTo(20, 6);
    expect(computeDefectIndex(input({ areaFraction: 1.0 })).index).toBeCloseTo(40, 6);
    expect(computeDefectIndex(input({ areaFraction: 0.25 })).areaComponent).toBeCloseTo(10, 6);
  });

  it('count component saturates at COUNT_INDEX_MAX (60)', () => {
    // 2×Class-C = weightedScore 30 = SATURATION_SCORE → countComponent hits the cap.
    const r = computeDefectIndex(input({ classC: 2 }));
    expect(r.countComponent).toBeCloseTo(DEFECT_INDEX_NORM.COUNT_INDEX_MAX, 6);
    expect(r.index).toBeCloseTo(60, 6);
  });

  it('count component is partial below saturation', () => {
    // 1×Class-C = 15 → 60 × 15/30 = 30
    expect(computeDefectIndex(input({ classC: 1 })).index).toBeCloseTo(30, 6);
    // 1×Class-B = 5 → 60 × 5/30 = 10
    expect(computeDefectIndex(input({ classB: 1 })).index).toBeCloseTo(10, 6);
  });

  it('index is clamped to [0, 100] even when counts + area overflow', () => {
    const r = computeDefectIndex(input({ classC: 10, areaFraction: 1 }));
    expect(r.index).toBe(100);
  });

  it('negative counts and out-of-range area are sanitised', () => {
    const r = computeDefectIndex(input({ classA: -5, classB: -1, areaFraction: 2 }));
    // negatives floored to 0, area clamped to 1 → 40
    expect(r.weightedScore).toBe(0);
    expect(r.index).toBeCloseTo(40, 6);
  });
});

describe('classifyDefectIndex — DEFAULT thresholds (IEC TS 60904-13)', () => {
  const { aMax, bMax } = DEFECT_THRESHOLDS.default; // 20 / 50

  it('grade A at and below aMax', () => {
    expect(classifyDefectIndex(0, 'default')).toBe('A');
    expect(classifyDefectIndex(aMax, 'default')).toBe('A'); // 20 inclusive
  });

  it('grade B just above aMax up to bMax', () => {
    expect(classifyDefectIndex(aMax + 0.01, 'default')).toBe('B');
    expect(classifyDefectIndex(bMax, 'default')).toBe('B'); // 50 inclusive
  });

  it('grade C above bMax', () => {
    expect(classifyDefectIndex(bMax + 0.01, 'default')).toBe('C');
    expect(classifyDefectIndex(100, 'default')).toBe('C');
  });

  it('defaults to DEFAULT mode when omitted', () => {
    expect(classifyDefectIndex(15)).toBe('A');
    expect(classifyDefectIndex(40)).toBe('B');
  });
});

describe('classifyDefectIndex — MBJ thresholds (stricter)', () => {
  const { aMax, bMax } = DEFECT_THRESHOLDS.mbj; // 10 / 30

  it('grade A at and below aMax (10)', () => {
    expect(classifyDefectIndex(aMax, 'mbj')).toBe('A');
  });

  it('grade B just above aMax up to bMax (30)', () => {
    expect(classifyDefectIndex(aMax + 0.01, 'mbj')).toBe('B');
    expect(classifyDefectIndex(bMax, 'mbj')).toBe('B');
  });

  it('grade C above bMax (30)', () => {
    expect(classifyDefectIndex(bMax + 0.01, 'mbj')).toBe('C');
  });
});

describe('DEFAULT vs MBJ mode differences', () => {
  it('MBJ grades stricter than DEFAULT at the same index', () => {
    // index 20: DEFAULT A (≤20), MBJ B (>10)
    expect(classifyDefectIndex(20, 'default')).toBe('A');
    expect(classifyDefectIndex(20, 'mbj')).toBe('B');

    // index 40: DEFAULT B (≤50), MBJ C (>30)
    expect(classifyDefectIndex(40, 'default')).toBe('B');
    expect(classifyDefectIndex(40, 'mbj')).toBe('C');
  });

  it('a real module: one Class-C defect grades B (default) but the area pushes MBJ to C', () => {
    // 1×Class-C + area 0.5 → countComponent 30 + areaComponent 20 = 50
    const { index } = computeDefectIndex(input({ classC: 1, areaFraction: 0.5 }));
    expect(index).toBeCloseTo(50, 6);
    expect(classifyDefectIndex(index, 'default')).toBe('B'); // 50 == bMax
    expect(classifyDefectIndex(index, 'mbj')).toBe('C'); // 50 > 30
  });

  it('MBJ aMax < DEFAULT aMax and MBJ bMax < DEFAULT bMax', () => {
    expect(DEFECT_THRESHOLDS.mbj.aMax).toBeLessThan(DEFECT_THRESHOLDS.default.aMax);
    expect(DEFECT_THRESHOLDS.mbj.bMax).toBeLessThan(DEFECT_THRESHOLDS.default.bMax);
  });
});

describe('describeGrade', () => {
  it('cites the active criteria set', () => {
    expect(describeGrade('A', 'default')).toContain('IEC TS 60904-13');
    expect(describeGrade('C', 'mbj')).toContain('MBJ');
    expect(describeGrade('B', 'default')).toContain('observe');
  });
});
