// Shared types for the Agnipariksha UI. Kept outside of `app/` so server and
// client modules can import them without dragging in the dashboard tree.

export type TestStatus = 'idle' | 'running' | 'paused' | 'pass' | 'fail' | 'aborted';

export interface LiveReading {
  timestamp: number;
  voltage: number;
  current: number;
  power: number;
  temperature?: number;
  channel?: string;
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
}

export type TabKey =
  | 'tc'
  | 'hf'
  | 'letid'
  | 'bdt'
  | 'rco'
  | 'gct'
  | 'results'
  | 'ai';

export interface TabDescriptor {
  key: TabKey;
  label: string;
  short: string;
  standard: string;
  dot: string; // Tailwind bg-* class, declared statically so JIT keeps it.
}

export const TAB_DESCRIPTORS: ReadonlyArray<TabDescriptor> = [
  { key: 'tc',      label: 'Thermal Cycling',          short: 'TC',     standard: 'IEC 61215 MQT11',    dot: 'bg-orange-400' },
  { key: 'hf',      label: 'Humidity Freeze',          short: 'HF',     standard: 'IEC 61215 MQT12',    dot: 'bg-sky-400' },
  { key: 'letid',   label: 'LeTID',                    short: 'LeTID',  standard: 'IEC TS 63342',       dot: 'bg-purple-400' },
  { key: 'bdt',     label: 'Bypass Diode',             short: 'BDT',    standard: 'IEC 62979',          dot: 'bg-yellow-400' },
  { key: 'rco',     label: 'Reverse Current Overload', short: 'RCO',    standard: 'IEC 61730 MST26',    dot: 'bg-red-400' },
  { key: 'gct',     label: 'Ground Continuity',        short: 'GCT',    standard: 'IEC 61730 MST13',    dot: 'bg-emerald-400' },
  { key: 'results', label: 'Results',                  short: 'Results',standard: 'Reports & exports',  dot: 'bg-steel-200' },
  { key: 'ai',      label: 'AI Assistant',             short: 'AI',     standard: 'Claude / OpenRouter',dot: 'bg-agni-orange' },
];
