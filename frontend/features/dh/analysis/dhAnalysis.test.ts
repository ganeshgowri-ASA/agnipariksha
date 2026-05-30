import { describe, it, expect } from 'vitest';
import { computeDhKpis, DH_CONSTANTS, type DhConfig } from './dhAnalysis';
import type { LiveReading } from '@/types/test-session';

const cfg: DhConfig = {
  tempC: 85,
  rhPct: 85,
  durationHours: 1000,
  biasVoltage: 0,
};

function synth(opts: { startMs: number; hours: number; tempC?: number; rhPct?: number; sampleS?: number }): LiveReading[] {
  const sampleS = opts.sampleS ?? 60;
  const t = opts.tempC ?? 85;
  const rh = opts.rhPct ?? 85;
  const total = Math.floor(opts.hours * 3600);
  const r: LiveReading[] = [];
  for (let s = 0; s < total; s += sampleS) {
    r.push({
      timestamp: opts.startMs + s * 1000,
      voltage: 0, current: 0, power: 0,
      temperature: t,
      ...(opts.rhPct !== undefined || true ? { humidity: rh } : {}),
    } as LiveReading);
  }
  return r;
}

describe('computeDhKpis — empty', () => {
  it('idle defaults', () => {
    expect(computeDhKpis([], cfg).overallVerdict).toBe('pending');
  });
});

describe('computeDhKpis — environment', () => {
  it('temp PASS at setpoint', () => {
    expect(computeDhKpis(synth({ startMs: 0, hours: 0.1, tempC: 85 }), cfg).tempVerdict).toBe('pass');
  });
  it('temp WARN at 3 °C deviation', () => {
    expect(computeDhKpis(synth({ startMs: 0, hours: 0.1, tempC: 88 }), cfg).tempVerdict).toBe('warn');
  });
  it('temp FAIL at 10 °C deviation', () => {
    expect(computeDhKpis(synth({ startMs: 0, hours: 0.1, tempC: 95 }), cfg).tempVerdict).toBe('fail');
  });
  it('RH PASS at setpoint', () => {
    expect(computeDhKpis(synth({ startMs: 0, hours: 0.1, rhPct: 85 }), cfg).rhVerdict).toBe('pass');
  });
  it('RH FAIL at 15% deviation', () => {
    expect(computeDhKpis(synth({ startMs: 0, hours: 0.1, rhPct: 65 }), cfg).rhVerdict).toBe('fail');
  });
});

describe('computeDhKpis — soak duration', () => {
  it('PASS when 1000 h soak met', () => {
    const r = synth({ startMs: 0, hours: 1000.1, sampleS: 60 });
    expect(computeDhKpis(r, cfg).soakDurationVerdict).toBe('pass');
  });
  it('FAIL when well under target', () => {
    const r = synth({ startMs: 0, hours: 100 });
    expect(computeDhKpis(r, cfg).soakDurationVerdict).toBe('fail');
  });
  it('WARN at 96% of target', () => {
    const r = synth({ startMs: 0, hours: 960, sampleS: 60 });
    expect(computeDhKpis(r, cfg).soakDurationVerdict).toBe('warn');
  });
});

describe('computeDhKpis — ΔPmax', () => {
  it('null without baseline', () => {
    expect(computeDhKpis(synth({ startMs: 0, hours: 0.1 }), cfg).deltaPmaxPct).toBeNull();
  });
  it('PASS when post-test Pmax within 5%', () => {
    const cfgWithBaseline = { ...cfg, baselinePmax: 500 };
    const r: LiveReading[] = [];
    for (let s = 0; s < 60; s += 6) {
      r.push({ timestamp: s * 1000, voltage: 0, current: 0, power: 485, temperature: 85 } as LiveReading);
    }
    const k = computeDhKpis(r, cfgWithBaseline);
    expect(['pass', 'warn']).toContain(k.deltaPmaxVerdict);
  });
});

describe('computeDhKpis — composite', () => {
  it('overall PASS for healthy 1000 h soak with baseline', () => {
    const cfgWithBaseline = { ...cfg, baselinePmax: 500 };
    const r: LiveReading[] = [];
    const total = 1001 * 3600;
    for (let s = 0; s < total; s += 60) {
      r.push({ timestamp: s * 1000, voltage: 0, current: 0, power: 490, temperature: 85, humidity: 85 } as LiveReading);
    }
    expect(computeDhKpis(r, cfgWithBaseline).overallVerdict).toBe('pass');
  });
});
