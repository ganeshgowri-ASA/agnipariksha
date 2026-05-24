// IEC 61215-2 MQT 18.1 — Bypass diode pulse test recipe model + validation.
// Pure (no React) so it can be unit-tested in isolation. The 62979
// continuous-runaway path is unrelated and lives in BypassDiodeTab.

export interface Mqt18Nameplate {
  manufacturer: string;
  model: string;
  msn: string;
  mcind: string;
  isc_a: number;
  voc_v: number;
  system_voltage_v: number;
}

export interface Mqt18Diode {
  id: string;
  part_number: string;
  tjmax_c: number;
  fuse_current_a: number;
}

export interface Mqt18Protocol {
  pulse_width_ms: number;
  currents_a: number[];
  temperature_steps_c: number[];
  repeats_per_step: number;
}

export interface Mqt18Equipment {
  psu_id: string;
  scope_id: string;
  tc_logger_id: string;
}

export interface Mqt18Recipe {
  nameplate: Mqt18Nameplate;
  diodes: Mqt18Diode[];
  protocol: Mqt18Protocol;
  equipment: Mqt18Equipment;
  operator: string;
}

export const MQT18_PULSE_WIDTH_MAX_MS = 1.0;
export const MQT18_DEFAULT_TEMPERATURE_STEPS_C = [30, 45, 60, 75, 90];
export const MQT18_DEFAULT_REPEATS_PER_STEP = 3;

// Per MQT 18.1 the diode is exercised at Isc and a low-current point;
// IEC fixes the low point at 10% of Isc.
export function deriveCurrents(iscA: number): number[] {
  if (!(iscA > 0)) return [];
  return [round3(iscA), round3(iscA * 0.1)];
}

export function makeDefaultMqt18Recipe(): Mqt18Recipe {
  return {
    nameplate: {
      manufacturer: '',
      model: '',
      msn: '',
      mcind: '',
      isc_a: 0,
      voc_v: 0,
      system_voltage_v: 0,
    },
    diodes: [makeDiode()],
    protocol: {
      pulse_width_ms: 1.0,
      currents_a: [],
      temperature_steps_c: [...MQT18_DEFAULT_TEMPERATURE_STEPS_C],
      repeats_per_step: MQT18_DEFAULT_REPEATS_PER_STEP,
    },
    equipment: {
      psu_id: 'PV6000',
      scope_id: '',
      tc_logger_id: '',
    },
    operator: '',
  };
}

let diodeSeq = 0;
export function makeDiode(): Mqt18Diode {
  diodeSeq += 1;
  return { id: `D${diodeSeq}`, part_number: '', tjmax_c: 0, fuse_current_a: 0 };
}

// Returns a list of human-readable errors. Empty array means valid.
export function validateMqt18Recipe(r: Mqt18Recipe): string[] {
  const errors: string[] = [];
  const np = r.nameplate;

  if (!nonEmpty(np.manufacturer)) errors.push('Nameplate: manufacturer is required.');
  if (!nonEmpty(np.model)) errors.push('Nameplate: model is required.');
  if (!nonEmpty(np.msn)) errors.push('Nameplate: module serial number (MSN) is required.');
  if (!(np.isc_a > 0)) errors.push('Nameplate: Isc must be greater than 0 A.');
  if (!(np.voc_v > 0)) errors.push('Nameplate: Voc must be greater than 0 V.');
  if (!(np.system_voltage_v > 0)) errors.push('Nameplate: system voltage must be greater than 0 V.');

  if (r.diodes.length < 1) {
    errors.push('At least one bypass diode is required.');
  }
  r.diodes.forEach((d, i) => {
    const tag = `Diode ${i + 1}`;
    if (!nonEmpty(d.part_number)) errors.push(`${tag}: part number is required.`);
    if (!(d.tjmax_c > 0)) errors.push(`${tag}: Tjmax must be greater than 0 °C.`);
    if (!(d.fuse_current_a > 0)) errors.push(`${tag}: fuse current must be greater than 0 A.`);
  });

  const p = r.protocol;
  if (!(p.pulse_width_ms > 0)) {
    errors.push('Protocol: pulse width must be greater than 0 ms.');
  } else if (p.pulse_width_ms > MQT18_PULSE_WIDTH_MAX_MS) {
    errors.push(`Protocol: pulse width must not exceed ${MQT18_PULSE_WIDTH_MAX_MS} ms.`);
  }
  if (p.currents_a.length < 1) {
    errors.push('Protocol: at least one test current is required (set Isc to derive).');
  } else if (p.currents_a.some(c => !(c > 0))) {
    errors.push('Protocol: all test currents must be greater than 0 A.');
  }
  if (p.temperature_steps_c.length < 1) {
    errors.push('Protocol: at least one temperature step is required.');
  } else if (p.temperature_steps_c.some(t => !Number.isFinite(t))) {
    errors.push('Protocol: temperature steps must all be numeric.');
  }
  if (!(Number.isInteger(p.repeats_per_step) && p.repeats_per_step >= 1)) {
    errors.push('Protocol: repeats per step must be an integer ≥ 1.');
  }

  if (!nonEmpty(r.equipment.psu_id)) errors.push('Equipment: PSU id is required.');
  if (!nonEmpty(r.equipment.tc_logger_id)) errors.push('Equipment: TC logger id is required.');

  if (!nonEmpty(r.operator)) errors.push('Operator is required.');

  return errors;
}

function nonEmpty(s: string): boolean {
  return typeof s === 'string' && s.trim().length > 0;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
