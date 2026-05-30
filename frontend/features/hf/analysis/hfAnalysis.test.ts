/**
 * Vitest coverage for Humidity Freeze analysis math (IEC 61215-2 MQT 12).
 */
import { describe, it, expect } from 'vitest';
import { computeHfKpis, hfIscGateSetpoint, rampCeilingCph, HF_CONSTANTS, type HfConfig } from './hfAnalysis';
import type { LiveReading } from '@/types/test-session';

const baseConfig: HfConfig = {
  cycles: 2,
  tHigh: 85,
  rhHigh: 85,
  tLow: -40,
  dwellHours: 20,
  isc: 9.5,
};

/** Construct a single MQT 12 cycle with the requested phase durations. */
function synthHfCycle(opts: {
  startMs: number;
  hotSoakS: number;
  coldSoakS: number;
  rhPct?: number;
  sampleS?: number;
}): LiveReading[] {
  const sampleS = opts.sampleS ?? 60;
  const readings: LiveReading[] = [];
  let ms = opts.startMs;
  // Hot/humid soak
  for (let s = 0; s < opts.hotSoakS; s += sampleS) {
    readings.push({
      timestamp: ms,
      voltage: 48, current: 9.5, power: 456,
      temperature: 85,
      ...(opts.rhPct !== undefined ? { humidity: opts.rhPct } : {}),
    } as LiveReading);
    ms += sampleS * 1000;
  }
  // Transition to cold (linear over 15 min)
  for (let t = 85; t > -40; t -= 5) {
    readings.push({ timestamp: ms, voltage: 0, current: 0, power: 0, temperature: t });
    ms += 60 * 1000;
  }
  // Cold freeze soak
  for (let s = 0; s < opts.coldSoakS; s += sampleS) {
    readings.push({ timestamp: ms, voltage: 0, current: 0, power: 0, temperature: -40 });
    ms += sampleS * 1000;
  }
  // Transition back up
  for (let t = -40; t < 85; t += 5) {
    readings.push({ timestamp: ms, voltage: 48, current: 9.5, power: 456, temperature: t });
    ms += 60 * 1000;
  }
  return readings;
}

describe('computeHfKpis — empty', () => {
  it('idle / pending defaults', () => {
    const k = computeHfKpis([], baseConfig);
    expect(k.phase).toBe('idle');
    expect(k.cycleIndex).toBe(0);
    expect(k.overallVerdict).toBe('pending');
    expect(k.iscGate).toBe('unknown');
  });
});

describe('computeHfKpis — phase detection', () => {
  it('classifies hot-humid-soak when T and RH in band', () => {
    const readings: LiveReading[] = [
      { timestamp: 0, voltage: 48, current: 9.5, power: 456, temperature: 85, humidity: 85 } as LiveReading,
    ];
    expect(computeHfKpis(readings, baseConfig).phase).toBe('hot-humid-soak');
  });

  it('classifies cold-freeze when T in band', () => {
    const readings: LiveReading[] = [
      { timestamp: 0, voltage: 0, current: 0, power: 0, temperature: -40 },
    ];
    expect(computeHfKpis(readings, baseConfig).phase).toBe('cold-freeze');
  });

  it('treats hot soak as humid-soak even without RH telemetry', () => {
    const readings: LiveReading[] = [
      { timestamp: 0, voltage: 48, current: 9.5, power: 456, temperature: 85 },
    ];
    // No RH = no proof of failure, so we still classify as hot-humid-soak.
    expect(computeHfKpis(readings, baseConfig).phase).toBe('hot-humid-soak');
  });
});

describe('computeHfKpis — Isc gate (MQT 11.6.3 a)', () => {
  it('cooling below 25 °C even at high Isc setpoint', () => {
    const readings: LiveReading[] = [{ timestamp: 0, voltage: 0, current: 0, power: 0, temperature: 10 }];
    expect(computeHfKpis(readings, baseConfig).iscGate).toBe('cooling');
  });

  it('injecting above 25 °C', () => {
    const readings: LiveReading[] = [{ timestamp: 0, voltage: 48, current: 9.5, power: 456, temperature: 60 }];
    expect(computeHfKpis(readings, baseConfig).iscGate).toBe('injecting');
  });

  it('hfIscGateSetpoint pure-function matches frontend rule', () => {
    expect(hfIscGateSetpoint(20, 9.5)).toBe(0);
    expect(hfIscGateSetpoint(26, 9.5)).toBe(9.5);
    expect(hfIscGateSetpoint(null, 9.5)).toBe(0);
  });
});

describe('computeHfKpis — dwell duration verdicts (MQT 12.6.2)', () => {
  it('passes when hot dwell ≥ 20 h and cold dwell ≥ 30 min', () => {
    const readings = synthHfCycle({
      startMs: 0,
      hotSoakS: HF_CONSTANTS.HOT_DWELL_MIN_S + 600,
      coldSoakS: HF_CONSTANTS.COLD_DWELL_MIN_S + 60,
      rhPct: 85,
      sampleS: 60,
    });
    const k = computeHfKpis(readings, baseConfig);
    expect(k.hotDwellVerdict).toBe('pass');
    expect(k.coldDwellVerdict).toBe('pass');
  });

  it('fails when dwell falls short', () => {
    const readings = synthHfCycle({
      startMs: 0,
      hotSoakS: HF_CONSTANTS.HOT_DWELL_MIN_S / 4,
      coldSoakS: HF_CONSTANTS.COLD_DWELL_MIN_S / 4,
      rhPct: 85,
      sampleS: 60,
    });
    const k = computeHfKpis(readings, baseConfig);
    expect(k.hotDwellVerdict).toBe('fail');
    expect(k.coldDwellVerdict).toBe('fail');
  });
});

describe('computeHfKpis — RH compliance', () => {
  it('passes when RH stays within 85 ± 5 %', () => {
    const readings = synthHfCycle({
      startMs: 0,
      hotSoakS: HF_CONSTANTS.HOT_DWELL_MIN_S + 60,
      coldSoakS: HF_CONSTANTS.COLD_DWELL_MIN_S + 60,
      rhPct: 86,
      sampleS: 60,
    });
    expect(computeHfKpis(readings, baseConfig).rhVerdict).toBe('pass');
  });

  it('fails when RH excursion is large and persistent', () => {
    const readings = synthHfCycle({
      startMs: 0,
      hotSoakS: HF_CONSTANTS.HOT_DWELL_MIN_S + 60,
      coldSoakS: HF_CONSTANTS.COLD_DWELL_MIN_S + 60,
      rhPct: 50, // way off target
      sampleS: 60,
    });
    expect(computeHfKpis(readings, baseConfig).rhVerdict).toBe('fail');
  });

  it('warns if chamber never reported RH but soak occurred', () => {
    const readings = synthHfCycle({
      startMs: 0,
      hotSoakS: HF_CONSTANTS.HOT_DWELL_MIN_S + 60,
      coldSoakS: HF_CONSTANTS.COLD_DWELL_MIN_S + 60,
      sampleS: 60,
    });
    expect(computeHfKpis(readings, baseConfig).rhVerdict).toBe('warn');
  });
});

describe('computeHfKpis — MQT 12 ramp rate (PR-L #139)', () => {
  /** Two-point series with a known ramp rate (°C/h). */
  function rampSeries(rampCph: number): LiveReading[] {
    return [
      { timestamp: 0,             voltage: 0, current: 0, power: 0, temperature: 25 } as LiveReading,
      { timestamp: 3_600_000,     voltage: 0, current: 0, power: 0, temperature: 25 + rampCph } as LiveReading,
    ];
  }

  it('rampCeilingCph resolves slow vs fast option', () => {
    expect(rampCeilingCph('slow-100')).toBe(100);
    expect(rampCeilingCph('fast-200')).toBe(200);
    expect(rampCeilingCph(undefined)).toBe(100); // conservative default
  });

  it('PASS at 90 °C/h under slow-100 ceiling', () => {
    const k = computeHfKpis(rampSeries(90), { ...baseConfig, rampOption: 'slow-100' });
    expect(k.rampCeilingCph).toBe(100);
    expect(k.rampVerdict).toBe('pass');
    expect(k.worstRampCph).toBeCloseTo(90, 1);
  });

  it('FAIL at 180 °C/h under slow-100 ceiling', () => {
    const k = computeHfKpis(rampSeries(180), { ...baseConfig, rampOption: 'slow-100' });
    expect(k.rampVerdict).toBe('fail');
  });

  it('SAME 180 °C/h ramp PASSes under fast-200 ceiling', () => {
    const k = computeHfKpis(rampSeries(180), { ...baseConfig, rampOption: 'fast-200' });
    expect(k.rampCeilingCph).toBe(200);
    expect(k.rampVerdict).toBe('pass');
  });

  it('WARN at 220 °C/h under fast-200 ceiling (1.2× warn band)', () => {
    const k = computeHfKpis(rampSeries(220), { ...baseConfig, rampOption: 'fast-200' });
    expect(k.rampVerdict).toBe('warn');
  });
});

describe('computeHfKpis — cycle counter', () => {
  it('counts cycles via cold-band → 25 °C upward crossings', () => {
    const c1 = synthHfCycle({ startMs: 0, hotSoakS: 3600, coldSoakS: 1800, rhPct: 85, sampleS: 600 });
    // Second cycle starts AFTER c1.
    const c1End = c1[c1.length - 1].timestamp + 60_000;
    const c2 = synthHfCycle({ startMs: c1End, hotSoakS: 3600, coldSoakS: 1800, rhPct: 85, sampleS: 600 });
    const readings = [...c1, ...c2];
    const k = computeHfKpis(readings, { ...baseConfig, cycles: 2 });
    expect(k.cycleIndex).toBeGreaterThanOrEqual(1);
    expect(k.cycleIndex).toBeLessThanOrEqual(2);
  });
});
