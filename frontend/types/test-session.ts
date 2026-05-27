export type TestStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'pass'
  | 'fail'
  | 'aborted';

export interface LiveReading {
  timestamp: number;
  voltage: number;
  current: number;
  power: number;
  temperature?: number;
  /** 4-wire resistance in ohms — set by the GCT live stream. */
  resistance?: number;
}

export interface TestSession {
  id: string;
  testType: string;
  startTime: number;
  endTime?: number;
  status: TestStatus;
  readings: LiveReading[];
  result?: 'PASS' | 'FAIL';
  notes?: string;
  preMaxPower?: number;
  postMaxPower?: number;
  iecClause?: string;
  rawDataPath?: string;
}

export type TestKey =
  | 'tc'
  | 'hf'
  | 'pid'
  | 'letid'
  | 'bdt'
  | 'rco'
  | 'gct'
  | 'el'
  | 'iir'
  | 'ir'
  | 'dh'
  | 'eb';

export interface TabDefinition {
  key: TestKey;
  label: string;
  short: string;
  color: string;
  std: string;
  clause: string;
}

export const TABS: TabDefinition[] = [
  { key: 'tc',    label: 'Thermal Cycling',          short: 'TC',    color: 'text-orange-400',  std: 'IEC 61215-2 MQT 11', clause: 'MQT 11' },
  { key: 'hf',    label: 'Humidity Freeze',          short: 'HF',    color: 'text-blue-400',    std: 'IEC 61215-2 MQT 12', clause: 'MQT 12' },
  { key: 'pid',   label: 'Potential Induced Degradation', short: 'PID', color: 'text-fuchsia-400', std: 'IEC TS 62804-1',  clause: 'TS 62804-1' },
  { key: 'letid', label: 'LeTID',                    short: 'LeTID', color: 'text-purple-400',  std: 'IEC TS 63342',       clause: 'TS 63342' },
  { key: 'bdt',   label: 'Bypass Diode',             short: 'BDT',   color: 'text-yellow-400',  std: 'IEC 61215-2 MQT 18', clause: 'MQT 18' },
  { key: 'rco',   label: 'Reverse Current Overload', short: 'RCO',   color: 'text-red-400',     std: 'IEC 61730 MST 26',   clause: 'MST 26' },
  { key: 'gct',   label: 'Ground Continuity',        short: 'GCT',   color: 'text-green-400',   std: 'IEC 61730 MST 13',   clause: 'MST 13' },
  { key: 'el',    label: 'Electroluminescence',      short: 'EL',    color: 'text-sky-400',     std: 'IEC TS 60904-13',    clause: 'TS 60904-13' },
  { key: 'iir',   label: 'Inverted IR',              short: 'IIR',   color: 'text-pink-400',    std: 'Forward-bias IR thermography', clause: 'IR' },
  { key: 'ir',    label: 'IR Forward-Bias Thermography', short: 'IR', color: 'text-amber-400', std: 'IEC TS 60904-12-1',  clause: 'TS 60904-12-1' },
  { key: 'dh',    label: 'Damp Heat',                short: 'DH',    color: 'text-cyan-400',    std: 'IEC 61215-2 MQT 13', clause: 'MQT 13' },
  { key: 'eb',    label: 'Equipotential Bonding',    short: 'EB',    color: 'text-emerald-400', std: 'IEC 61730 MST 13',   clause: 'MST 13' },
];

export const GATE2_PMAX_DELTA_PERCENT = -5;
