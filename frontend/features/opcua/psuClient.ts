// Pure (no React) client-side model + validation for the OPC UA PSU
// dashboard. Kept framework-free so it can be unit-tested in isolation and
// reused by the hook. Mirrors backend/app/opcua_api.py (PsuStateOut /
// SetpointsIn) and the WRITABLE_NODES allow-list.

export interface PsuReadings {
  voltage_v: number;
  current_a: number;
  power_w: number;
  temperature_c: number;
}

export interface PsuSetpoints {
  voltage_v: number;
  current_a: number;
  output_enabled: boolean;
}

export interface PsuState extends PsuReadings {
  model: string;
  mode: string;
  writable_nodes: string[];
}

// Matches the FastAPI Field bounds on SetpointsIn.
export const SETPOINT_LIMITS = {
  voltage_v: { min: 0, max: 1000 },
  current_a: { min: 0, max: 100 },
} as const;

function inRange(x: unknown, lo: number, hi: number): boolean {
  return typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
}

/** Human-readable errors for a candidate setpoint; empty array means valid. */
export function validateSetpoint(sp: Partial<PsuSetpoints>): string[] {
  const errors: string[] = [];
  const { voltage_v: v, current_a: c } = SETPOINT_LIMITS;
  if (!inRange(sp.voltage_v, v.min, v.max)) {
    errors.push(`Voltage setpoint must be ${v.min}–${v.max} V.`);
  }
  if (!inRange(sp.current_a, c.min, c.max)) {
    errors.push(`Current setpoint must be ${c.min}–${c.max} A.`);
  }
  return errors;
}

export function isSetpointValid(sp: Partial<PsuSetpoints>): boolean {
  return validateSetpoint(sp).length === 0;
}

/** A node is client-writable iff it is in the server's allow-list. */
export function isNodeWritable(node: string, writableNodes: string[]): boolean {
  return writableNodes.includes(node);
}

/** Expected delivered power for a setpoint (0 when output is disabled). */
export function expectedPower(sp: PsuSetpoints): number {
  return sp.output_enabled ? sp.voltage_v * sp.current_a : 0;
}
