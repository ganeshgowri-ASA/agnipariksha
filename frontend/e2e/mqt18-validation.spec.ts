import { test, expect } from '@playwright/test';
import {
  deriveCurrents,
  makeDefaultMqt18Recipe,
  validateMqt18Recipe,
  type Mqt18Recipe,
} from '../components/tabs/bdt/mqt18';

// Pure validation unit tests — no browser/page needed; Playwright is the
// only test runner wired into this repo's CI, so we ride on it.

function validRecipe(): Mqt18Recipe {
  const r = makeDefaultMqt18Recipe();
  r.nameplate = {
    manufacturer: 'Acme PV',
    model: 'AP-400',
    msn: 'SN-0001',
    mcind: 'MC-7',
    isc_a: 10,
    voc_v: 48,
    system_voltage_v: 1000,
  };
  r.diodes = [{ id: 'D1', part_number: 'SBR10U40', tjmax_c: 175, fuse_current_a: 15 }];
  r.protocol.currents_a = deriveCurrents(10);
  r.equipment = { psu_id: 'PV6000', scope_id: '', tc_logger_id: 'TC-1' };
  r.operator = 'tester';
  return r;
}

test.describe('deriveCurrents', () => {
  test('returns [Isc, 0.1*Isc] when Isc set', () => {
    expect(deriveCurrents(10)).toEqual([10, 1]);
    expect(deriveCurrents(8.5)).toEqual([8.5, 0.85]);
  });
  test('returns empty for non-positive Isc', () => {
    expect(deriveCurrents(0)).toEqual([]);
    expect(deriveCurrents(-3)).toEqual([]);
    expect(deriveCurrents(NaN)).toEqual([]);
  });
});

test.describe('validateMqt18Recipe', () => {
  test('a fully populated recipe passes', () => {
    expect(validateMqt18Recipe(validRecipe())).toEqual([]);
  });

  test('default recipe (blank) reports the required-field errors', () => {
    const errors = validateMqt18Recipe(makeDefaultMqt18Recipe());
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('manufacturer'))).toBe(true);
    expect(errors.some(e => e.includes('Isc'))).toBe(true);
    expect(errors.some(e => e.includes('test current'))).toBe(true);
    expect(errors.some(e => e.includes('Operator'))).toBe(true);
  });

  test('rejects pulse width above 1.0 ms', () => {
    const r = validRecipe();
    r.protocol.pulse_width_ms = 1.5;
    expect(validateMqt18Recipe(r).some(e => e.includes('pulse width'))).toBe(true);
  });

  test('rejects pulse width of 0', () => {
    const r = validRecipe();
    r.protocol.pulse_width_ms = 0;
    expect(validateMqt18Recipe(r).some(e => e.includes('pulse width'))).toBe(true);
  });

  test('requires at least one diode', () => {
    const r = validRecipe();
    r.diodes = [];
    expect(validateMqt18Recipe(r).some(e => e.includes('At least one'))).toBe(true);
  });

  test('flags an incomplete diode row', () => {
    const r = validRecipe();
    r.diodes = [{ id: 'D1', part_number: '', tjmax_c: 0, fuse_current_a: 0 }];
    const errors = validateMqt18Recipe(r);
    expect(errors.some(e => e.includes('part number'))).toBe(true);
    expect(errors.some(e => e.includes('Tjmax'))).toBe(true);
    expect(errors.some(e => e.includes('fuse current'))).toBe(true);
  });

  test('requires repeats_per_step to be an integer >= 1', () => {
    const r = validRecipe();
    r.protocol.repeats_per_step = 0;
    expect(validateMqt18Recipe(r).some(e => e.includes('repeats per step'))).toBe(true);
    r.protocol.repeats_per_step = 2.5;
    expect(validateMqt18Recipe(r).some(e => e.includes('repeats per step'))).toBe(true);
  });

  test('requires PSU and TC logger but scope is optional', () => {
    const r = validRecipe();
    r.equipment.scope_id = '';
    expect(validateMqt18Recipe(r)).toEqual([]);
    r.equipment.psu_id = '';
    expect(validateMqt18Recipe(r).some(e => e.includes('PSU'))).toBe(true);
    r.equipment.tc_logger_id = '';
    expect(validateMqt18Recipe(r).some(e => e.includes('TC logger'))).toBe(true);
  });

  test('requires at least one temperature step', () => {
    const r = validRecipe();
    r.protocol.temperature_steps_c = [];
    expect(validateMqt18Recipe(r).some(e => e.includes('temperature step'))).toBe(true);
  });
});
