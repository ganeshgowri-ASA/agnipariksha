import type { LiveReading } from '@/types/test-session';

/**
 * Build a Live Monitor sample. Electrical power is P = V * I in watts.
 * A prior bug divided by 1000, so 50.33 V * 11.44 A rendered as 0.58 W
 * instead of 575.77 W in the BDT Live Monitor.
 */
export function buildLiveSample(
  voltage_v: number,
  current_a: number,
  temperature_c?: number,
): LiveReading & { power_w: number } {
  const power_w = voltage_v * current_a;
  return {
    timestamp: Date.now(),
    voltage: +voltage_v.toFixed(3),
    current: +current_a.toFixed(3),
    power: +power_w.toFixed(3),
    power_w,
    temperature: temperature_c == null ? undefined : +temperature_c.toFixed(1),
  };
}
