/**
 * Report section catalogue + per-Module-ID persistence.
 *
 * The Report tab lets the operator choose which sections appear in the
 * exported PDF / Word. The selection is keyed by Module ID so a repeat
 * run of the same module remembers its previously-chosen template.
 */

export type ReportSectionKey =
  | 'cover'
  | 'setup'
  | 'telemetry'
  | 'analysis'
  | 'photos'
  | 'appendix'
  | 'iec_clauses';

export interface ReportSectionDef {
  key: ReportSectionKey;
  label: string;
  description: string;
}

export const REPORT_SECTIONS: ReportSectionDef[] = [
  { key: 'cover',       label: 'Cover',       description: 'Title page header with lab + test name' },
  { key: 'setup',       label: 'Setup',       description: 'Module / operator / date parameter table' },
  { key: 'telemetry',   label: 'Telemetry',   description: 'Voltage, current, power summary + trend chart' },
  { key: 'analysis',    label: 'Analysis',    description: 'Gate-2 ΔPmax check and verdict' },
  { key: 'photos',      label: 'Photos',      description: 'Attached photo references (path | caption per line)' },
  { key: 'appendix',    label: 'Appendix',    description: 'Notes and raw-data file path' },
  { key: 'iec_clauses', label: 'IEC clauses', description: 'Standard / clause reference text' },
];

export type ReportSectionSelection = Record<ReportSectionKey, boolean>;

export const ALL_SECTIONS_ON: ReportSectionSelection = REPORT_SECTIONS.reduce(
  (acc, s) => { acc[s.key] = true; return acc; },
  {} as ReportSectionSelection,
);

const STORAGE_PREFIX = 'agni-report-sections::';
const PHOTOS_PREFIX = 'agni-report-photos::';

function normaliseModuleId(moduleId: string): string {
  const trimmed = moduleId.trim();
  return trimmed.length > 0 ? trimmed : '__default__';
}

export function sectionsStorageKey(moduleId: string): string {
  return `${STORAGE_PREFIX}${normaliseModuleId(moduleId)}`;
}

export function photosStorageKey(moduleId: string): string {
  return `${PHOTOS_PREFIX}${normaliseModuleId(moduleId)}`;
}

export function loadSectionSelection(moduleId: string): ReportSectionSelection {
  if (typeof window === 'undefined') return { ...ALL_SECTIONS_ON };
  try {
    const raw = window.localStorage.getItem(sectionsStorageKey(moduleId));
    if (!raw) return { ...ALL_SECTIONS_ON };
    const parsed = JSON.parse(raw) as Partial<ReportSectionSelection>;
    const out: ReportSectionSelection = { ...ALL_SECTIONS_ON };
    for (const s of REPORT_SECTIONS) {
      if (typeof parsed[s.key] === 'boolean') out[s.key] = parsed[s.key] as boolean;
    }
    return out;
  } catch {
    return { ...ALL_SECTIONS_ON };
  }
}

export function saveSectionSelection(moduleId: string, sel: ReportSectionSelection): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(sectionsStorageKey(moduleId), JSON.stringify(sel));
  } catch {
    /* localStorage may be disabled (private mode / quota) — silently ignore */
  }
}

export function loadPhotoRefs(moduleId: string): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(photosStorageKey(moduleId)) ?? '';
  } catch {
    return '';
  }
}

export function savePhotoRefs(moduleId: string, text: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(photosStorageKey(moduleId), text);
  } catch {
    /* ignore */
  }
}

/**
 * Canned IEC reference paragraph keyed by test standard. Falls back to a
 * generic placeholder when the standard isn't recognised — the operator
 * can still untick the section if no text applies.
 */
export function iecClauseReference(standard: string, clause?: string): string[] {
  const std = standard.toUpperCase();
  if (std.includes('MQT 11')) {
    return [
      'IEC 61215-2 MQT 11 — Thermal Cycling Test.',
      'Subject the module to 200 thermal cycles between -40 °C and +85 °C',
      'at a maximum ramp rate of 100 °C/h and minimum dwell of 10 min at',
      'each extreme. Apply Isc current during the high-temperature plateau',
      'when module temperature is above 25 °C.',
    ];
  }
  if (std.includes('MQT 12')) {
    return [
      'IEC 61215-2 MQT 12 — Humidity-Freeze Test.',
      '10 cycles of +85 °C / 85 %RH for 20 h, followed by transition to',
      '-40 °C within 1 h, dwell 30 min, then return to high-T/RH plateau.',
      'After conditioning, verify Pmax degradation does not exceed 5 % of',
      'the pre-test value (IEC 61215-2 Gate 2 criterion).',
    ];
  }
  if (std.includes('MQT 13')) {
    return [
      'IEC 61215-2 MQT 13 — Damp-Heat Test.',
      'Continuous exposure at +85 °C / 85 %RH for 1000 h. Insulation',
      'resistance and wet leakage are re-verified post-conditioning.',
    ];
  }
  if (std.includes('MQT 18')) {
    return [
      'IEC 61215-2 MQT 18 — Bypass-Diode Thermal Test.',
      'Force 1.25 × Isc through the bypass-diode network for 1 h with',
      'module temperature stabilised at +75 °C. Diode junction temperature',
      'must remain within the manufacturer\'s rating.',
    ];
  }
  if (std.includes('TS 63342') || std.includes('LETID')) {
    return [
      'IEC TS 63342 — LeTID (Light & Elevated Temperature Induced',
      'Degradation). Apply Isc − Imp forward current at +75 °C for 162 h',
      'and measure Pmax degradation. Failure criterion follows the same',
      '5 % ΔPmax gate as 61215-2.',
    ];
  }
  if (std.includes('MST 26')) {
    return [
      'IEC 61730 MST 26 — Reverse-Current Overload Test.',
      'Apply 135 % of the rated series fuse current in reverse for 2 h.',
      'No ignition, melting of polymeric materials, or loss of insulation',
      'integrity is permitted.',
    ];
  }
  if (std.includes('MST 13')) {
    return [
      'IEC 61730 MST 13 — Continuity of Equipotential Bonding.',
      'Drive 25 A between any two accessible conductive parts. Resistance',
      'measured at the junction must be ≤ 0.1 Ω.',
    ];
  }
  return [
    `${standard}${clause ? ` — ${clause}` : ''}.`,
    'Refer to the published standard for the full procedure and pass/fail',
    'criteria. (Add a project-specific clause summary in this section.)',
  ];
}

export interface PhotoRef { path: string; caption: string }

export function parsePhotoRefs(text: string): PhotoRef[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const idx = line.indexOf('|');
      if (idx === -1) return { path: line, caption: '' };
      return { path: line.slice(0, idx).trim(), caption: line.slice(idx + 1).trim() };
    });
}
