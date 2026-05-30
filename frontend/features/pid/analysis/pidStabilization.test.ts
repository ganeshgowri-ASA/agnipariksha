/**
 * Vitest coverage for PID stabilization conformity
 * (IEC 61215-2 MQT 21 + IEC TS 62804-1).
 */
import { describe, it, expect } from 'vitest';
import {
  STABILIZATION_CONSTANTS,
  clampStabilizationHours,
  tempConformity,
  rhConformity,
  stabilizationVerdict,
} from './pidStabilization';

describe('clampStabilizationHours — MQT 21 [12, 24] h window', () => {
  it('passes through values inside the window', () => {
    expect(clampStabilizationHours(12)).toBe(12);
    expect(clampStabilizationHours(18)).toBe(18);
    expect(clampStabilizationHours(24)).toBe(24);
  });

  it('clamps below the floor up to 12 h', () => {
    expect(clampStabilizationHours(11.9)).toBe(12);
    expect(clampStabilizationHours(0)).toBe(12);
    expect(clampStabilizationHours(-5)).toBe(12);
  });

  it('clamps above the ceiling down to 24 h', () => {
    expect(clampStabilizationHours(24.1)).toBe(24);
    expect(clampStabilizationHours(96)).toBe(24);
  });

  it('falls back to the floor for NaN', () => {
    expect(clampStabilizationHours(Number.NaN)).toBe(STABILIZATION_CONSTANTS.MIN_STABILIZATION_H);
  });
});

describe('tempConformity — tight post-stab band (±1 °C)', () => {
  it('is pending without a reading', () => {
    expect(tempConformity(null, 60)).toBe('pending');
  });

  it('conforms at the setpoint and on the tight boundary', () => {
    expect(tempConformity(60, 60)).toBe('conform');
    expect(tempConformity(61, 60)).toBe('conform'); // exactly +1 °C
    expect(tempConformity(59, 60)).toBe('conform'); // exactly -1 °C
  });

  it('is non-conform just past the tight band (which the wide band would tolerate)', () => {
    expect(tempConformity(61.1, 60)).toBe('non-conform');
    // 1.5 °C deviation is inside the WIDE ±2 °C band but breaches the tight band.
    expect(STABILIZATION_CONSTANTS.T_TOL_WIDE_C).toBeGreaterThan(STABILIZATION_CONSTANTS.T_TOL_TIGHT_C);
    expect(tempConformity(61.5, 60)).toBe('non-conform');
  });
});

describe('rhConformity — tight post-stab band (±3 %RH)', () => {
  it('is pending without a reading', () => {
    expect(rhConformity(null, 85)).toBe('pending');
  });

  it('conforms at the setpoint and on the tight boundary', () => {
    expect(rhConformity(85, 85)).toBe('conform');
    expect(rhConformity(88, 85)).toBe('conform'); // exactly +3 %
    expect(rhConformity(82, 85)).toBe('conform'); // exactly -3 %
  });

  it('is non-conform just past the tight band (which the wide band would tolerate)', () => {
    expect(rhConformity(88.1, 85)).toBe('non-conform');
    // 4 % deviation is inside the WIDE ±5 % band but breaches the tight band.
    expect(STABILIZATION_CONSTANTS.RH_TOL_WIDE_PCT).toBeGreaterThan(STABILIZATION_CONSTANTS.RH_TOL_TIGHT_PCT);
    expect(rhConformity(89, 85)).toBe('non-conform');
  });
});

describe('stabilizationVerdict — composite post-stab conformity', () => {
  it('is pending until both axes have a reading', () => {
    expect(stabilizationVerdict(null, 60, 85, 85)).toBe('pending');
    expect(stabilizationVerdict(60, 60, null, 85)).toBe('pending');
  });

  it('conforms when both T and RH are inside their tight bands', () => {
    expect(stabilizationVerdict(60.5, 60, 86, 85)).toBe('conform');
  });

  it('NON-CONFORM when temperature breaches the tight band', () => {
    expect(stabilizationVerdict(62, 60, 85, 85)).toBe('non-conform');
  });

  it('NON-CONFORM when humidity breaches the tight band', () => {
    expect(stabilizationVerdict(60, 60, 90, 85)).toBe('non-conform');
  });
});
