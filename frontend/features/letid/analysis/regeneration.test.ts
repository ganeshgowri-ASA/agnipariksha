import { describe, it, expect } from 'vitest';
import {
  movingAverage,
  detectRegenerationOnset,
  evaluateStopCriterion,
  judgeLetid,
  type LetidPoint,
  type SmoothedPoint,
} from './regeneration';
import { generateLetidDemoCurve, DEMO_LETID_POINTS } from './demoData';

const totalVariation = (vals: number[]) =>
  vals.reduce((s, v, i) => (i ? s + Math.abs(v - vals[i - 1]) : 0), 0);
const meanAbsErr = (vals: number[], hrs: number[], f: (t: number) => number) =>
  vals.reduce((s, v, i) => s + Math.abs(v - f(hrs[i])), 0) / vals.length;

describe('movingAverage — smooths a noisy synthetic curve within tolerance', () => {
  const f = (t: number) => 0.5 + 0.012 * Math.sin(t / 18);
  const raw: LetidPoint[] = [];
  for (let t = 0; t <= 120; t += 2) {
    const noise = 0.004 * Math.sin(t * 2.3) + 0.002 * Math.cos(t * 3.1);
    raw.push({ hours: t, darkVoc: f(t) + noise });
  }

  it('cuts high-frequency jitter (total variation) substantially', () => {
    const sm = movingAverage(raw, 6);
    expect(sm).toHaveLength(raw.length);
    expect(sm.map((p) => p.hours)).toEqual(raw.map((p) => p.hours));
    const rawTV = totalVariation(raw.map((p) => p.darkVoc));
    const smTV = totalVariation(sm.map((p) => p.smoothedV));
    expect(smTV).toBeLessThan(rawTV * 0.7);
  });

  it('tracks the underlying curve more closely than the raw series', () => {
    const sm = movingAverage(raw, 6);
    const hrs = raw.map((p) => p.hours);
    const smMae = meanAbsErr(sm.map((p) => p.smoothedV), hrs, f);
    const rawMae = meanAbsErr(raw.map((p) => p.darkVoc), hrs, f);
    expect(smMae).toBeLessThan(rawMae);
  });

  it('returns [] for empty input and is robust to unsorted input', () => {
    expect(movingAverage([], 6)).toEqual([]);
    const unsorted: LetidPoint[] = [
      { hours: 10, darkVoc: 0.50 },
      { hours: 0, darkVoc: 0.52 },
      { hours: 5, darkVoc: 0.51 },
    ];
    const sm = movingAverage(unsorted, 100);
    expect(sm.map((p) => p.hours)).toEqual([0, 5, 10]);
    // Wide window → every point is the mean of all three.
    const mean = (0.52 + 0.51 + 0.5) / 3;
    for (const p of sm) expect(p.smoothedV).toBeCloseTo(mean, 12);
  });
});

describe('detectRegenerationOnset — finds the seeded local minimum within ±2 h', () => {
  it('locates a symmetric parabolic minimum despite light ripple', () => {
    const tSeed = 50;
    const points: LetidPoint[] = [];
    for (let t = 0; t <= 120; t += 2) {
      const base = 0.5 + 4e-6 * (t - tSeed) ** 2; // min at t=50
      const ripple = 0.0003 * Math.sin(t * (Math.PI / 3)); // 6 h period → debounced out
      points.push({ hours: t, darkVoc: base + ripple });
    }
    const { onsetHours, minV } = detectRegenerationOnset(movingAverage(points, 6));
    expect(onsetHours).not.toBeNull();
    expect(Math.abs((onsetHours as number) - tSeed)).toBeLessThanOrEqual(2);
    expect(minV).toBeCloseTo(0.5, 2);
  });

  it('returns null when the curve only degrades (no upturn)', () => {
    const declining: SmoothedPoint[] = [];
    for (let t = 0; t <= 100; t += 5) declining.push({ hours: t, smoothedV: 0.6 - 0.0005 * t });
    expect(detectRegenerationOnset(declining).onsetHours).toBeNull();
  });

  it('rejects a brief blip that does not satisfy the 3-sample debounce', () => {
    // Down, one-sample up, then back down — not a sustained regeneration.
    const v = [0.60, 0.58, 0.56, 0.57, 0.55, 0.53, 0.51];
    const smoothed: SmoothedPoint[] = v.map((smoothedV, i) => ({ hours: i * 2, smoothedV }));
    expect(detectRegenerationOnset(smoothed).onsetHours).toBeNull();
  });
});

describe('evaluateStopCriterion — flat tail vs still-rising tail', () => {
  it('returns stopReached=true on a flat tail', () => {
    const flat: SmoothedPoint[] = [];
    for (let t = 0; t <= 120; t += 2) {
      flat.push({ hours: t, smoothedV: t < 80 ? 0.55 + (0.05 * t) / 80 : 0.6 });
    }
    const r = evaluateStopCriterion(flat);
    expect(r.stopReached).toBe(true);
    expect(r.atHours).not.toBeNull();
    expect(r.atHours as number).toBeGreaterThanOrEqual(80);
  });

  it('returns stopReached=false on a still-rising tail', () => {
    const rising: SmoothedPoint[] = [];
    for (let t = 0; t <= 120; t += 2) rising.push({ hours: t, smoothedV: 0.55 + 0.0005 * t });
    const r = evaluateStopCriterion(rising);
    expect(r.stopReached).toBe(false);
    expect(r.atHours).toBeNull();
  });

  it('does not mistake the zero-slope regeneration minimum for a plateau', () => {
    // Curve dips to a min then keeps rising to the end — no trailing plateau.
    const smoothed = movingAverage(
      generateLetidDemoCurve({ tPlateauHrs: 240, totalHrs: 240, rippleV: 0 }),
      6,
    );
    expect(evaluateStopCriterion(smoothed).stopReached).toBe(false);
  });
});

describe('judgeLetid — overall verdicts', () => {
  it('PASS on the demo curve with clear regeneration recovery', () => {
    const j = judgeLetid(DEMO_LETID_POINTS, 75);
    expect(j.verdict).toBe('PASS');
    expect(j.onsetHours).not.toBeNull();
    expect(j.onsetHours as number).toBeGreaterThanOrEqual(60);
    expect(j.onsetHours as number).toBeLessThanOrEqual(80);
    expect(j.stopHours).not.toBeNull();
    expect(j.deltaVFromMin as number).toBeGreaterThanOrEqual(0.001);
  });

  it('REVIEW when a plateau is reached but the recovery is marginal (< 0.001 V)', () => {
    // Clear onset + flat plateau, but the regenerated level is only ~0.8 mV above the min.
    const marginal = generateLetidDemoCurve({ vMin: 0.56, vPlateau: 0.5608, rippleV: 0 });
    const j = judgeLetid(marginal, 75);
    expect(j.verdict).toBe('REVIEW');
    expect(j.stopHours).not.toBeNull();
    expect(j.deltaVFromMin as number).toBeLessThan(0.001);
  });

  it('FAIL on a monotonically declining 700 h curve (no regeneration onset)', () => {
    const decline: LetidPoint[] = [];
    for (let t = 0; t <= 700; t += 10) decline.push({ hours: t, darkVoc: 0.6 - 5e-5 * t });
    const j = judgeLetid(decline, 75);
    expect(j.verdict).toBe('FAIL');
    expect(j.onsetHours).toBeNull();
  });

  it('IN_PROGRESS while still degrading under the 600 h limit', () => {
    const short: LetidPoint[] = [];
    for (let t = 0; t <= 100; t += 5) short.push({ hours: t, darkVoc: 0.6 - 2e-4 * t });
    const j = judgeLetid(short, 75);
    expect(j.verdict).toBe('IN_PROGRESS');
    expect(j.onsetHours).toBeNull();
  });
});
