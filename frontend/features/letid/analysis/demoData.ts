import type { LetidPoint } from './regeneration';
import type { LiveReading } from '@/types/test-session';

/**
 * Parametric LeTID demo curve (IEC TS 63342). Dark V_oc follows the canonical
 * three-phase shape: a sine-eased initial degradation to a minimum, a
 * cosine-eased regeneration up to a plateau, then a flat plateau. A small
 * deterministic ripple is added on the active phases (tapered to zero on the
 * plateau) so the raw series visibly differs from its moving average; the
 * ripple's short period keeps its positive-slope runs under the onset debounce,
 * so it never registers as a false regeneration onset.
 *
 * Defaults seed a min near 70 h and a plateau from ~190 h over a 0..240 h run —
 * exercising both the onset and the stop-criterion detectors.
 */
export interface LetidDemoOpts {
  v0?: number;              // initial dark V_oc, V
  vMin?: number;            // V_oc at the degradation minimum, V
  vPlateau?: number;        // V_oc at the regenerated plateau, V
  tMinHrs?: number;         // hours at the minimum (regeneration onset)
  tPlateauHrs?: number;     // hours at which the plateau is reached
  totalHrs?: number;        // total exposure, hours
  stepHrs?: number;         // sampling interval, hours
  rippleV?: number;         // ripple amplitude on the active phases, V
  ripplePeriodHrs?: number; // ripple period, hours (short → debounced out)
}

export function generateLetidDemoCurve(opts: LetidDemoOpts = {}): LetidPoint[] {
  const {
    v0 = 0.6,
    vMin = 0.56,
    vPlateau = 0.61,
    tMinHrs = 70,
    tPlateauHrs = 190,
    totalHrs = 240,
    stepHrs = 2,
    rippleV = 0.0006,
    ripplePeriodHrs = 8,
  } = opts;

  const points: LetidPoint[] = [];
  for (let t = 0; t <= totalHrs + 1e-9; t += stepHrs) {
    let base: number;
    if (t <= tMinHrs) {
      // Degradation: V0 → vMin, slope steepest at t=0, flattening into the min.
      base = vMin + (v0 - vMin) * (1 - Math.sin((Math.PI / 2) * (t / tMinHrs)));
    } else if (t <= tPlateauHrs) {
      // Regeneration: vMin → vPlateau, slope zero at both ends (smooth min/entry).
      const u = (t - tMinHrs) / (tPlateauHrs - tMinHrs);
      base = vMin + (vPlateau - vMin) * (1 - Math.cos(Math.PI * u)) / 2;
    } else {
      base = vPlateau;
    }

    // Deterministic ripple, tapered to zero by the plateau.
    const taper = Math.max(0, 1 - t / tPlateauHrs);
    const ripple = rippleV * Math.sin((2 * Math.PI * t) / ripplePeriodHrs) * taper;

    points.push({ hours: +t.toFixed(2), darkVoc: +(base + ripple).toFixed(6) });
  }
  return points;
}

/** Default demo fixture consumed by the LeTID Analysis sub-tab. */
export const DEMO_LETID_POINTS: LetidPoint[] = generateLetidDemoCurve();

/**
 * Demo LiveReading[] for the dark-voltage / temperature / injected-current
 * monitor (IEC TS 63342). The soak alternates injection and dark sub-phases:
 * on dark sub-phases the current drops to ≈0 and the terminal voltage equals
 * the canonical dark-V_oc curve above; on injection sub-phases the PSU drives
 * `idark` at the regenerated Vmpp. Module temperature dithers around the 75 °C
 * setpoint. Sampled relative to `t0` (default now) so the panel can map
 * timestamps onto elapsed hours exactly as the live stream does.
 */
export function generateLetidDemoReadings(
  opts: LetidDemoOpts & { t0?: number; idark?: number; vmpp?: number; tSetC?: number } = {},
): LiveReading[] {
  const { t0 = Date.now(), idark = 0.6, vmpp = 37.5, tSetC = 75 } = opts;
  const curve = generateLetidDemoCurve(opts);
  return curve.map((p, i) => {
    // Alternate ~dark/injection sub-phases so the monitor shows both states.
    const isDark = i % 4 < 2;
    const tempC = +(tSetC + 1.2 * Math.sin(i / 3)).toFixed(2);
    return {
      timestamp: t0 + p.hours * 3_600_000,
      voltage: isDark ? p.darkVoc : +vmpp.toFixed(3),
      current: isDark ? 0 : +idark.toFixed(3),
      power: isDark ? 0 : +(vmpp * idark).toFixed(3),
      temperature: tempC,
    };
  });
}

/** Default demo readings consumed by the LeTID dark-voltage monitor. */
export const DEMO_LETID_READINGS: LiveReading[] = generateLetidDemoReadings();
