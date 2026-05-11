// Test schemas for each IEC test. Each schema defines its IEC-specific
// parameter fields plus the derived statistics & step count exposed by the
// shared test-tab UI. Tab components import their schema and never duplicate
// the underlying field metadata.

export type TestId = 'tc' | 'hf' | 'letid' | 'bdt' | 'rco' | 'gct';

export interface ModuleSpec {
  sampleId: string;
  voc: number;
  isc: number;
  vmp: number;
  imp: number;
  pmax: number;
  fuseRating: number;
}

export const DEFAULT_MODULE_SPEC: ModuleSpec = {
  sampleId: '',
  voc: 48.0,
  isc: 10.0,
  vmp: 40.5,
  imp: 9.5,
  pmax: 385,
  fuseRating: 15,
};

export interface TestParamField {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}

export interface DerivedStat {
  label: string;
  value: string;
  unit: string;
  color?: string;
}

export interface TestLimits {
  maxVoltage: number;
  maxCurrent: number;
  maxPower: number;
  maxTemp?: number;
}

export interface TestSchema {
  id: TestId;
  testName: string;
  shortName: string;
  standard: string;
  clause: string;
  description: string;
  color: string;
  accentHex: string;
  totalSteps: number;
  limits: TestLimits;
  params: ReadonlyArray<TestParamField>;
  derive: (params: Readonly<Record<string, number>>, mod: ModuleSpec) => DerivedStat[];
  estimatedDurationSec: (params: Readonly<Record<string, number>>) => number;
  passFailHint: string;
}

const param = (
  key: string,
  label: string,
  unit: string,
  min: number,
  max: number,
  step: number,
  defaultValue: number,
): TestParamField => ({ key, label, unit, min, max, step, defaultValue });

const TC: TestSchema = {
  id: 'tc',
  testName: 'Thermal Cycling',
  shortName: 'TC',
  standard: 'IEC 61215-2:2021',
  clause: 'MQT 11',
  description:
    '200 cycles between −40 °C and +85 °C with current equal to Isc. Ramp ≤ 100 °C/hr, dwell ≥ 10 min at each extreme.',
  color: 'text-orange-400',
  accentHex: '#fb923c',
  totalSteps: 200,
  limits: { maxVoltage: 100, maxCurrent: 20, maxPower: 2000, maxTemp: 100 },
  params: [
    param('cycles', 'Cycles', 'cycles', 1, 1000, 1, 200),
    param('tMin', 'T min', '°C', -60, 0, 1, -40),
    param('tMax', 'T max', '°C', 50, 110, 1, 85),
    param('rampRate', 'Ramp rate', '°C/hr', 10, 100, 5, 100),
    param('dwellMin', 'Dwell', 'min', 5, 60, 1, 10),
  ],
  derive: (p, mod) => [
    { label: 'Test Current', value: mod.isc.toFixed(2), unit: 'A', color: 'text-orange-400' },
    { label: 'T Range', value: `${p.tMin} → ${p.tMax}`, unit: '°C', color: 'text-yellow-400' },
    { label: 'Cycle Period', value: estimateCyclePeriodMin(p).toFixed(0), unit: 'min', color: 'text-blue-400' },
  ],
  estimatedDurationSec: (p) => Math.round(p.cycles * estimateCyclePeriodMin(p) * 60),
  passFailHint:
    'PASS if no visible damage, insulation R unchanged, Pmax loss ≤ 5 %, ΔIsc ≤ 5 %, ΔVoc ≤ 5 %.',
};

const HF: TestSchema = {
  id: 'hf',
  testName: 'Humidity Freeze',
  shortName: 'HF',
  standard: 'IEC 61215-2:2021',
  clause: 'MQT 12',
  description:
    '10 cycles: 20 h at +85 °C / 85 % RH, then ramp to −40 °C with ≥ 30 min dwell. No bias applied.',
  color: 'text-blue-400',
  accentHex: '#60a5fa',
  totalSteps: 10,
  limits: { maxVoltage: 100, maxCurrent: 20, maxPower: 2000, maxTemp: 100 },
  params: [
    param('cycles', 'Cycles', 'cycles', 1, 50, 1, 10),
    param('tHigh', 'High temp', '°C', 40, 100, 1, 85),
    param('rh', 'Humidity', '%RH', 60, 100, 1, 85),
    param('tLow', 'Low temp', '°C', -60, 0, 1, -40),
    param('dwellHigh', 'High dwell', 'hr', 1, 24, 1, 20),
    param('dwellLow', 'Low dwell', 'min', 15, 240, 5, 30),
  ],
  derive: (p) => [
    { label: 'High Stage', value: `${p.tHigh}°C / ${p.rh}%`, unit: '', color: 'text-cyan-400' },
    { label: 'Low Stage', value: `${p.tLow}`, unit: '°C', color: 'text-blue-400' },
    { label: 'Cycle Length', value: ((p.dwellHigh) + p.dwellLow / 60 + 4).toFixed(1), unit: 'hr', color: 'text-yellow-400' },
  ],
  estimatedDurationSec: (p) =>
    Math.round(p.cycles * (p.dwellHigh * 3600 + (p.dwellLow + 240) * 60)),
  passFailHint:
    'PASS if insulation resistance ≥ 40 MΩ·m², wet-leakage compliant, Pmax loss ≤ 5 %.',
};

const LETID: TestSchema = {
  id: 'letid',
  testName: 'LeTID',
  shortName: 'LID',
  standard: 'IEC TS 63342:2022',
  clause: '§7 Procedure A (current injection)',
  description:
    'Inject dark current Idark = Isc − Imp at 75 °C ± 3 °C for ≥ 162 h. Stabilisation checked at intermediate intervals.',
  color: 'text-purple-400',
  accentHex: '#c084fc',
  totalSteps: 162,
  limits: { maxVoltage: 100, maxCurrent: 20, maxPower: 2000, maxTemp: 85 },
  params: [
    param('temperature', 'Temperature', '°C', 70, 80, 1, 75),
    param('durationHr', 'Duration', 'hr', 100, 500, 1, 162),
    param('checkpointHr', 'Checkpoint', 'hr', 6, 48, 1, 12),
  ],
  derive: (_, mod) => {
    const idark = +(mod.isc - mod.imp).toFixed(3);
    return [
      { label: 'Idark = Isc − Imp', value: idark.toFixed(3), unit: 'A', color: 'text-purple-400' },
      { label: 'Module Pmax', value: mod.pmax.toFixed(0), unit: 'W', color: 'text-yellow-400' },
    ];
  },
  estimatedDurationSec: (p) => Math.round(p.durationHr * 3600),
  passFailHint: 'PASS if relative Pmax degradation ≤ 5 % after stabilisation.',
};

const BDT: TestSchema = {
  id: 'bdt',
  testName: 'Bypass Diode Thermal',
  shortName: 'BDT',
  standard: 'IEC 62979:2017',
  clause: '§5 Thermal Test',
  description:
    'Each bypass diode is stressed at 1.35 × Isc for 1 hour with module body at 75 °C. Junction temperature must stay < 128 °C.',
  color: 'text-yellow-400',
  accentHex: '#facc15',
  totalSteps: 3,
  limits: { maxVoltage: 100, maxCurrent: 20, maxPower: 2000, maxTemp: 130 },
  params: [
    param('numDiodes', 'Diodes', 'count', 1, 12, 1, 3),
    param('ambientC', 'Ambient T', '°C', 20, 85, 1, 75),
    param('hoursPerDiode', 'Hours / diode', 'hr', 0.5, 5, 0.5, 1),
    param('iscMultiplier', 'Isc multiplier', '×', 1.0, 1.5, 0.05, 1.35),
  ],
  derive: (p, mod) => {
    const i = +(mod.isc * p.iscMultiplier).toFixed(3);
    return [
      { label: 'Stress Current', value: i.toFixed(2), unit: 'A', color: 'text-yellow-400' },
      { label: 'Per-diode time', value: p.hoursPerDiode.toFixed(1), unit: 'hr', color: 'text-orange-400' },
      { label: 'Ambient', value: p.ambientC.toFixed(0), unit: '°C', color: 'text-red-400' },
    ];
  },
  estimatedDurationSec: (p) => Math.round(p.numDiodes * p.hoursPerDiode * 3600),
  passFailHint: 'FAIL if Tj ≥ 128 °C or diode fails open during the 1 h dwell.',
};

const RCO: TestSchema = {
  id: 'rco',
  testName: 'Reverse Current Overload',
  shortName: 'RCO',
  standard: 'IEC 61730-2:2016',
  clause: 'MST 26',
  description:
    'Force 1.35 × max series fuse rating in reverse through the module for 2 hours. No flame, no melting of polymeric parts.',
  color: 'text-red-400',
  accentHex: '#f87171',
  totalSteps: 1,
  limits: { maxVoltage: 10, maxCurrent: 50, maxPower: 500, maxTemp: 60 },
  params: [
    param('fuseMultiplier', 'Fuse multiplier', '×', 1.0, 1.5, 0.05, 1.35),
    param('durationHr', 'Duration', 'hr', 0.5, 10, 0.5, 2),
    param('voltageLimit', 'Voltage limit', 'V', 0.1, 5, 0.1, 1.0),
  ],
  derive: (p, mod) => {
    const i = +(mod.fuseRating * p.fuseMultiplier).toFixed(3);
    return [
      { label: 'Test Current', value: i.toFixed(2), unit: 'A', color: 'text-red-400' },
      { label: 'V Limit', value: p.voltageLimit.toFixed(1), unit: 'V', color: 'text-blue-400' },
      { label: 'Duration', value: p.durationHr.toFixed(1), unit: 'hr', color: 'text-yellow-400' },
    ];
  },
  estimatedDurationSec: (p) => Math.round(p.durationHr * 3600),
  passFailHint:
    'PASS if no fire, no melting of polymer parts, no exposed live conductors after test.',
};

const GCT: TestSchema = {
  id: 'gct',
  testName: 'Ground Continuity',
  shortName: 'GCT',
  standard: 'IEC 61730-2:2016',
  clause: 'MST 13',
  description:
    'Inject 25 A between earth bond and every exposed conductive frame point. R ≤ 0.1 Ω, V ≤ 2.5 V.',
  color: 'text-green-400',
  accentHex: '#34d399',
  totalSteps: 5,
  limits: { maxVoltage: 5, maxCurrent: 30, maxPower: 150, maxTemp: 40 },
  params: [
    param('testCurrent', 'Test current', 'A', 10, 30, 1, 25),
    param('durationMin', 'Per-point time', 'min', 1, 10, 0.5, 2),
    param('maxResistance', 'Max R', 'Ω', 0.01, 1.0, 0.01, 0.1),
    param('numPoints', 'Test points', 'pts', 1, 20, 1, 5),
  ],
  derive: (p) => [
    { label: 'Resistance Limit', value: p.maxResistance.toFixed(3), unit: 'Ω', color: 'text-yellow-400' },
    { label: 'Points', value: p.numPoints.toFixed(0), unit: '', color: 'text-blue-400' },
    { label: 'Per-point', value: p.durationMin.toFixed(1), unit: 'min', color: 'text-green-400' },
  ],
  estimatedDurationSec: (p) => Math.round(p.numPoints * p.durationMin * 60),
  passFailHint: 'PASS if measured R ≤ 0.1 Ω at every measurement point with 25 A injection.',
};

export const TEST_SCHEMAS: Record<TestId, TestSchema> = {
  tc: TC,
  hf: HF,
  letid: LETID,
  bdt: BDT,
  rco: RCO,
  gct: GCT,
};

export function defaultParams(schema: TestSchema): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of schema.params) out[p.key] = p.defaultValue;
  return out;
}

function estimateCyclePeriodMin(p: Readonly<Record<string, number>>): number {
  const span = Math.abs((p.tMax ?? 85) - (p.tMin ?? -40));
  const rampMin = (span / Math.max(1, p.rampRate ?? 100)) * 60;
  return rampMin * 2 + (p.dwellMin ?? 10) * 2;
}
