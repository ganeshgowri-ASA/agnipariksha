import { describe, it, expect } from 'vitest';
import {
  SETPOINT_LIMITS,
  validateSetpoint,
  isSetpointValid,
  isNodeWritable,
  expectedPower,
} from './psuClient';

describe('validateSetpoint — bounds mirror backend SetpointsIn', () => {
  it('accepts an in-range setpoint', () => {
    expect(validateSetpoint({ voltage_v: 48, current_a: 2, output_enabled: true })).toEqual([]);
    expect(isSetpointValid({ voltage_v: 0, current_a: 0, output_enabled: false })).toBe(true);
  });

  it('accepts the exact min/max bounds', () => {
    expect(isSetpointValid({ voltage_v: SETPOINT_LIMITS.voltage_v.max, current_a: SETPOINT_LIMITS.current_a.max })).toBe(true);
    expect(isSetpointValid({ voltage_v: 0, current_a: 0 })).toBe(true);
  });

  it('rejects out-of-range voltage', () => {
    expect(validateSetpoint({ voltage_v: -1, current_a: 2 })).toHaveLength(1);
    expect(validateSetpoint({ voltage_v: 1001, current_a: 2 })).toHaveLength(1);
  });

  it('rejects out-of-range current', () => {
    expect(validateSetpoint({ voltage_v: 48, current_a: -0.1 })).toHaveLength(1);
    expect(validateSetpoint({ voltage_v: 48, current_a: 101 })).toHaveLength(1);
  });

  it('rejects NaN / missing fields', () => {
    expect(validateSetpoint({ voltage_v: NaN, current_a: 2 })).toHaveLength(1);
    expect(validateSetpoint({})).toHaveLength(2);
  });
});

describe('isNodeWritable — allow-list', () => {
  const writable = ['Voltage_Setpoint_V', 'Current_Setpoint_A', 'Output_Enabled'];
  it('permits setpoint nodes only', () => {
    expect(isNodeWritable('Voltage_Setpoint_V', writable)).toBe(true);
    expect(isNodeWritable('Output_Enabled', writable)).toBe(true);
    expect(isNodeWritable('Voltage_V', writable)).toBe(false);
    expect(isNodeWritable('Temperature_C', writable)).toBe(false);
  });
});

describe('expectedPower', () => {
  it('is V·I when enabled, 0 when disabled', () => {
    expect(expectedPower({ voltage_v: 48, current_a: 2, output_enabled: true })).toBe(96);
    expect(expectedPower({ voltage_v: 48, current_a: 2, output_enabled: false })).toBe(0);
  });
});
