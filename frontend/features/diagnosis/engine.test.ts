import { describe, it, expect } from 'vitest';
import { diagnose, type RunMetrics } from './engine';

describe('diagnose — rule triggering per test kind', () => {
  it('TC: flags ramp excursion + short dwell + unstable injection together', () => {
    const m: RunMetrics = {
      worstRampCph: 140,
      rampCeilingCph: 100,
      dwellMinutes: 6,
      injectedCurrentDeltaPct: 3.4,
    };
    const f = diagnose('tc', m);
    expect(f.map((x) => x.id)).toEqual([
      'ramp-too-fast',
      'dwell-short',
      'injection-unstable', // criticals sort before warnings
    ]);
    expect(f[0].clause).toContain('61215-2:2021');
    expect(f[0].causes.length).toBeGreaterThan(0);
    expect(f[0].recommendations.length).toBeGreaterThan(0);
  });

  it('TC: ramp within the selected fast-200 ceiling does not trigger', () => {
    const f = diagnose('tc', { worstRampCph: 150, rampCeilingCph: 200, dwellMinutes: 12 });
    expect(f[0].id).toBe('healthy');
    expect(f[0].severity).toBe('ok');
  });

  it('HF: RH dip below band is critical and cites MQT 12', () => {
    const f = diagnose('hf', { rhExcursionPctMin: 72 });
    expect(f[0].id).toBe('rh-low');
    expect(f[0].severity).toBe('critical');
    expect(f[0].clause).toContain('MQT 12');
  });

  it('PID: high leakage + short stabilization, criticals first', () => {
    const f = diagnose('pid', { leakageCurrentUa: 120, stabilizationHours: 8 });
    expect(f[0].id).toBe('pid-leakage-high');
    expect(f[1].id).toBe('pid-stabilization-short');
    expect(f[1].clause).toContain('62804');
  });

  it('LeTID: null regeneration onset triggers; a value does not', () => {
    expect(diagnose('letid', { regenerationOnsetH: null, moduleTempC: 68 })[0].id).toBe(
      'letid-no-regeneration',
    );
    expect(diagnose('letid', { regenerationOnsetH: 96 })[0].id).toBe('healthy');
  });

  it('BDT: Tj over limit is critical; default limit is 200 °C', () => {
    const f = diagnose('bdt', { tjMaxObservedC: 214 });
    expect(f[0].id).toBe('bdt-tj-over');
    expect(f[0].clause).toContain('MQT 18.1');
    // configurable limit respected
    expect(diagnose('bdt', { tjMaxObservedC: 150, tjLimitC: 120 })[0].id).toBe('bdt-tj-over');
  });

  it('GCT: resistance at 0.1 Ω fails per IEC 61730-2:2023 MST 13', () => {
    const f = diagnose('gct', { worstPathOhm: 0.1 });
    expect(f[0].id).toBe('gct-resistance-high');
    expect(f[0].clause).toContain('61730-2:2023');
    expect(diagnose('gct', { worstPathOhm: 0.031 })[0].id).toBe('healthy');
  });

  it('RCO: hotspot + short hold both reported with MST 26 clause', () => {
    const f = diagnose('rco', { moduleTempMaxC: 118, holdHours: 0.5 });
    expect(f.map((x) => x.id)).toEqual(['rco-overtemp', 'rco-hold-short']);
    expect(f[0].clause).toContain('MST 26');
  });

  it('healthy run yields exactly one ok finding with a recommendation', () => {
    const f = diagnose('gct', {});
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('ok');
    expect(f[0].recommendations).toHaveLength(1);
  });
});
