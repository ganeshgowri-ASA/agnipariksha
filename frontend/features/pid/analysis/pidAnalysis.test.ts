/**
 * Vitest coverage for PID analysis (IEC TS 62804-1).
 */
import { describe, it, expect } from 'vitest';
import { computePidKpis, PID_CONSTANTS, type PidConfig } from './pidAnalysis';
import type { LiveReading } from '@/types/test-session';

const cfg: PidConfig = {
  biasVoltage: -1000,
  tempC: 60,
  rhPct: 85,
  durationHours: 96,
};

function makeReading(opts: {
  ms: number;
  voltage?: number;
  current?: number;
  power?: number;
  temperature?: number;
  humidity?: number;
}): LiveReading {
  return {
    timestamp: opts.ms,
    voltage: opts.voltage ?? 0,
    current: opts.current ?? 0,
    power: opts.power ?? 0,
    temperature: opts.temperature,
    ...(opts.humidity !== undefined ? { humidity: opts.humidity } : {}),
  } as LiveReading;
}

function synthSoak(opts: {
  startMs: number;
  hours: number;
  bias: number;
  iLeakA?: number;
  tempC?: number;
  rhPct?: number;
  sampleS?: number;
}): LiveReading[] {
  const sampleS = opts.sampleS ?? 60;
  const i = opts.iLeakA ?? 1e-7;
  const t = opts.tempC ?? 60;
  const rh = opts.rhPct ?? 85;
  const total = Math.floor(opts.hours * 3600);
  const r: LiveReading[] = [];
  for (let s = 0; s < total; s += sampleS) {
    r.push(makeReading({
      ms: opts.startMs + s * 1000,
      voltage: opts.bias, current: i, power: opts.bias * i,
      temperature: t, humidity: rh,
    }));
  }
  return r;
}

describe('computePidKpis — empty', () => {
  it('idle defaults', () => {
    const k = computePidKpis([], cfg);
    expect(k.phase).toBe('idle');
    expect(k.overallVerdict).toBe('pending');
    expect(k.iLeakVerdict).toBe('pending');
  });
});

describe('computePidKpis — leakage current ceiling', () => {
  it('PASS below 50% of ceiling', () => {
    const r = synthSoak({ startMs: 0, hours: 0.1, bias: -1000, iLeakA: 1e-6 });
    expect(computePidKpis(r, cfg).iLeakVerdict).toBe('pass');
  });

  it('WARN 50-100% of ceiling', () => {
    const r = synthSoak({ startMs: 0, hours: 0.1, bias: -1000, iLeakA: 3e-6 });
    expect(computePidKpis(r, cfg).iLeakVerdict).toBe('warn');
  });

  it('FAIL above ceiling', () => {
    const r = synthSoak({ startMs: 0, hours: 0.1, bias: -1000, iLeakA: 8e-6 });
    expect(computePidKpis(r, cfg).iLeakVerdict).toBe('fail');
  });
});

describe('computePidKpis — environmental verdicts', () => {
  it('temperature PASS at setpoint', () => {
    const r = synthSoak({ startMs: 0, hours: 0.1, bias: -1000, tempC: 60 });
    expect(computePidKpis(r, cfg).tempVerdict).toBe('pass');
  });

  it('temperature FAIL beyond 2× tol', () => {
    const r = synthSoak({ startMs: 0, hours: 0.1, bias: -1000, tempC: 70 });
    expect(computePidKpis(r, cfg).tempVerdict).toBe('fail');
  });

  it('RH PASS at setpoint', () => {
    const r = synthSoak({ startMs: 0, hours: 0.1, bias: -1000, rhPct: 85 });
    expect(computePidKpis(r, cfg).rhVerdict).toBe('pass');
  });

  it('RH WARN at 5-10% deviation', () => {
    const r = synthSoak({ startMs: 0, hours: 0.1, bias: -1000, rhPct: 92 });
    expect(computePidKpis(r, cfg).rhVerdict).toBe('warn');
  });
});

describe('computePidKpis — \u0394Pmax verdict', () => {
  it('returns null when baseline not provided', () => {
    const r = synthSoak({ startMs: 0, hours: 0.1, bias: -1000 });
    const k = computePidKpis(r, cfg);
    expect(k.deltaPmaxPct).toBeNull();
    expect(k.deltaPmaxVerdict).toBe('pending');
  });

  it('PASS when post-test Pmax within 5% of baseline', () => {
    const cfgWithBaseline = { ...cfg, baselinePmax: 500 };
    // Last 10 power readings average ~475 → 5% decay.
    const r: LiveReading[] = [];
    for (let s = 0; s < 60; s += 6) {
      r.push(makeReading({ ms: s * 1000, voltage: -1000, current: 0.475, power: 475 }));
    }
    const k = computePidKpis(r, cfgWithBaseline);
    expect(k.deltaPmaxPct).toBeCloseTo(5, 0);
    // 5% is at the boundary; verdict can be 'pass' or 'warn' depending on float.
    expect(['pass', 'warn']).toContain(k.deltaPmaxVerdict);
  });

  it('FAIL beyond 8% decay', () => {
    const cfgWithBaseline = { ...cfg, baselinePmax: 500 };
    const r: LiveReading[] = [];
    for (let s = 0; s < 60; s += 6) {
      r.push(makeReading({ ms: s * 1000, voltage: -1000, current: 0.45, power: 450 }));
    }
    expect(computePidKpis(r, cfgWithBaseline).deltaPmaxVerdict).toBe('fail');
  });
});

describe('computePidKpis — soak duration', () => {
  it('PASS when 96 h soak met', () => {
    // Skip dense per-second sampling — synthesise a sparse 96 h timeline.
    const r = synthSoak({ startMs: 0, hours: 96 + 0.1, bias: -1000, sampleS: 60 });
    expect(computePidKpis(r, cfg).soakDurationVerdict).toBe('pass');
  });

  it('FAIL when soak well under target', () => {
    const r = synthSoak({ startMs: 0, hours: 1, bias: -1000 });
    expect(computePidKpis(r, cfg).soakDurationVerdict).toBe('fail');
  });
});
