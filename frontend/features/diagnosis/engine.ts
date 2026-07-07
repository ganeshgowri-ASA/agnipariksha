// Rule-based test-run diagnosis (the "what went wrong" engine).
//
// Modeled on IV-tracer diagnosis tabs: given the observed metrics of a
// completed/aborted run, emit findings — what went wrong, probable causes,
// and concrete recommendations — each anchored to its IEC clause.
// Pure and framework-free so it is vitest-covered and reusable by the
// report builders. Editions per operator direction (2026-07): IEC
// 61215-2:2021 for MQT tests, IEC 61730-2:2023 for MST tests,
// IEC TS 62804-1 for PID, IEC TS 63342 for LeTID.

export type TestKind = 'tc' | 'hf' | 'pid' | 'letid' | 'bdt' | 'gct' | 'rco';
export type Severity = 'critical' | 'warning' | 'info' | 'ok';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  observed: string;
  causes: string[];
  recommendations: string[];
  clause: string;
}

/** Observed metrics of a run. Only the fields for the chosen test matter. */
export interface RunMetrics {
  // TC / HF (chamber + injection)
  worstRampCph?: number;        // worst observed ramp magnitude, °C/h
  rampCeilingCph?: number;      // selected ceiling (100 slow / 200 fast)
  dwellMinutes?: number;        // dwell at each extreme
  extremeOvershootC?: number;   // overshoot beyond -40/+85 setpoints
  injectedCurrentDeltaPct?: number; // |actual-set|/set × 100 during injection
  rhExcursionPctMin?: number;   // lowest RH seen during the 85 %RH phase (HF)
  // PID
  leakageCurrentUa?: number;
  stabilizationHours?: number;
  // LeTID
  regenerationOnsetH?: number | null; // null = never reached
  moduleTempC?: number;
  // BDT (MQT 18.1)
  tjMaxObservedC?: number;
  tjLimitC?: number;
  fitR2?: number;
  // GCT (MST 13)
  worstPathOhm?: number;
  gctCurrentDeltaPct?: number;
  // RCO (MST 26)
  holdHours?: number;
  moduleTempMaxC?: number;
}

interface Rule {
  id: string;
  applies: TestKind[];
  when: (m: RunMetrics) => boolean;
  make: (m: RunMetrics) => Omit<Finding, 'id'>;
}

const RULES: Rule[] = [
  {
    id: 'ramp-too-fast',
    applies: ['tc', 'hf'],
    when: (m) =>
      m.worstRampCph !== undefined &&
      m.worstRampCph > (m.rampCeilingCph ?? 100),
    make: (m) => ({
      severity: 'critical',
      title: 'Temperature ramp exceeded the IEC ceiling',
      observed: `Worst ramp ${m.worstRampCph?.toFixed(0)} °C/h vs ceiling ${m.rampCeilingCph ?? 100} °C/h.`,
      causes: [
        'Chamber PID tuned too aggressively for the loaded thermal mass',
        'Chamber under-loaded (few modules → faster air temperature swing)',
        'Wrong profile selected (fast-200 profile while slow-100 was intended)',
      ],
      recommendations: [
        'Reduce the chamber ramp setpoint and re-verify with a trial cycle',
        'Add dummy modules / thermal mass to slow the air response',
        'Re-run the affected cycles — a ramp excursion invalidates the cycle count',
      ],
      clause: 'IEC 61215-2:2021 MQT 11/12 (ramp between extremes)',
    }),
  },
  {
    id: 'dwell-short',
    applies: ['tc', 'hf'],
    when: (m) => m.dwellMinutes !== undefined && m.dwellMinutes < 10,
    make: (m) => ({
      severity: 'critical',
      title: 'Dwell at temperature extreme shorter than 10 min',
      observed: `Dwell ${m.dwellMinutes?.toFixed(1)} min at the extreme.`,
      causes: [
        'Cycle timer counted from chamber-air setpoint, not module temperature',
        'Chamber never fully reached the extreme before the next ramp started',
      ],
      recommendations: [
        'Gate the dwell timer on module (not air) thermocouple temperature',
        'Extend the programmed dwell; re-run the short cycles',
      ],
      clause: 'IEC 61215-2:2021 MQT 11 (10 min minimum dwell)',
    }),
  },
  {
    id: 'injection-unstable',
    applies: ['tc', 'hf'],
    when: (m) =>
      m.injectedCurrentDeltaPct !== undefined && m.injectedCurrentDeltaPct > 2,
    make: (m) => ({
      severity: 'warning',
      title: 'Injected current deviated from setpoint',
      observed: `|ΔI| = ${m.injectedCurrentDeltaPct?.toFixed(1)} % of setpoint (limit 2 %).`,
      causes: [
        'Lead/contact resistance rising with temperature (loose lugs)',
        'PSU thermal derating during the hot dwell',
        'Sense leads not connected (2-wire regulation at the PSU terminals)',
      ],
      recommendations: [
        'Re-torque connections; inspect for oxidation at module leads',
        'Use remote (4-wire) sense at the module',
        'Check PSU fan/airflow; log PSU heatsink temperature next run',
      ],
      clause: 'IEC 61215-2:2021 MQT 11 (current injection during cycling)',
    }),
  },
  {
    id: 'rh-low',
    applies: ['hf'],
    when: (m) => m.rhExcursionPctMin !== undefined && m.rhExcursionPctMin < 80,
    make: (m) => ({
      severity: 'critical',
      title: 'Relative humidity fell below band during the 85 %RH phase',
      observed: `RH dipped to ${m.rhExcursionPctMin?.toFixed(0)} % (band 85 ±5 %).`,
      causes: [
        'Humidifier water reservoir low / demineralised-water supply out',
        'Door seal leak; chamber recovering after a door open',
        'Dehumidifier valve stuck partially open',
      ],
      recommendations: [
        'Check reservoir + water feed before restarting',
        'Verify door gasket; log door-open events with the run',
        'Re-run the affected humidity-freeze cycles',
      ],
      clause: 'IEC 61215-2:2021 MQT 12 (85 % RH hot phase)',
    }),
  },
  {
    id: 'pid-stabilization-short',
    applies: ['pid'],
    when: (m) =>
      m.stabilizationHours !== undefined && m.stabilizationHours < 12,
    make: (m) => ({
      severity: 'warning',
      title: 'Post-stress stabilization shorter than 12 h',
      observed: `Stabilization ${m.stabilizationHours?.toFixed(1)} h (12–24 h required).`,
      causes: ['Run stopped early to free the chamber', 'Timer misconfigured'],
      recommendations: [
        'Extend stabilization to ≥12 h before the post-stress characterisation',
      ],
      clause: 'IEC TS 62804-1 (stabilization before final measurement)',
    }),
  },
  {
    id: 'pid-leakage-high',
    applies: ['pid'],
    when: (m) => m.leakageCurrentUa !== undefined && m.leakageCurrentUa > 50,
    make: (m) => ({
      severity: 'critical',
      title: 'Leakage current abnormally high during bias',
      observed: `Leakage ${m.leakageCurrentUa?.toFixed(0)} µA.`,
      causes: [
        'Condensation track on the module surface or leads',
        'Foil/electrode contact wrapping a junction box',
        'Insulation breakdown of a test lead inside the chamber',
      ],
      recommendations: [
        'Inspect for condensation paths; verify chamber dew-point control',
        'Re-dress the foil electrode clear of the J-box and cable glands',
        'Megger the leads outside the chamber before re-running',
      ],
      clause: 'IEC TS 62804-1 (system-voltage bias, leakage monitoring)',
    }),
  },
  {
    id: 'letid-no-regeneration',
    applies: ['letid'],
    when: (m) => m.regenerationOnsetH === null,
    make: (m) => ({
      severity: 'warning',
      title: 'No regeneration onset observed within the run',
      observed: `Dark-V_oc showed no regeneration; module at ${m.moduleTempC?.toFixed(0) ?? '—'} °C.`,
      causes: [
        'Module temperature below the 75 °C setpoint (sensor placement / airflow)',
        'Injection current below I_dark = I_sc − I_mp (PSU limit or lead drop)',
        'Cell technology genuinely slow to regenerate (not an equipment fault)',
      ],
      recommendations: [
        'Verify module-backsheet thermocouple placement and 75 ±5 °C control',
        'Confirm I_dark against the nameplate I_sc − I_mp; use 4-wire sense',
        'Extend the run per TS 63342 stop criteria before concluding',
      ],
      clause: 'IEC TS 63342 (LeTID regeneration / stop criteria)',
    }),
  },
  {
    id: 'bdt-tj-over',
    applies: ['bdt'],
    when: (m) =>
      m.tjMaxObservedC !== undefined &&
      m.tjMaxObservedC > (m.tjLimitC ?? 200),
    make: (m) => ({
      severity: 'critical',
      title: 'Bypass diode junction temperature exceeded T_j,max',
      observed: `T_j peaked at ${m.tjMaxObservedC?.toFixed(0)} °C vs limit ${m.tjLimitC ?? 200} °C.`,
      causes: [
        'Diode with degraded thermal path (dry solder / lifted pad) — genuine FAIL',
        'Thermocouple detached from the diode body (reading ambient then re-attaching)',
        'Test current above 1.25 × I_sc due to mis-entered I_sc',
      ],
      recommendations: [
        'Repeat with verified TC bonding; X-ray/cross-section the J-box if it repeats',
        'Cross-check the entered I_sc against the module nameplate',
        'Record the diode as FAIL per MQT 18.1 if the reading is confirmed',
      ],
      clause: 'IEC 61215-2:2021 MQT 18.1 (bypass diode thermal test)',
    }),
  },
  {
    id: 'bdt-fit-poor',
    applies: ['bdt'],
    when: (m) => m.fitR2 !== undefined && m.fitR2 < 0.85,
    make: (m) => ({
      severity: 'warning',
      title: 'V_D–T_j regression fit is poor',
      observed: `R² = ${m.fitR2?.toFixed(2)} (< 0.85).`,
      causes: [
        'Intermittent thermocouple contact during the sweep',
        'Diode not thermally settled between temperature steps',
        'Electrical noise on the V_D sense pair',
      ],
      recommendations: [
        'Re-bond the TC; allow longer soak per temperature step',
        'Twist + shield the V_D sense pair; re-run the sweep',
      ],
      clause: 'IEC 61215-2:2021 MQT 18.1 (V_D vs T_j characterisation)',
    }),
  },
  {
    id: 'gct-resistance-high',
    applies: ['gct'],
    when: (m) => m.worstPathOhm !== undefined && m.worstPathOhm >= 0.1,
    make: (m) => ({
      severity: 'critical',
      title: 'Grounding-path resistance at/above the 0.1 Ω limit',
      observed: `Worst path ${m.worstPathOhm?.toFixed(3)} Ω (limit < 0.1 Ω).`,
      causes: [
        'Oxidised or painted frame joint in the current path',
        'Grounding screw loose / star washer missing',
        'Probe placed on anodised surface instead of the grounding point',
      ],
      recommendations: [
        'Clean to bare metal and re-torque the grounding hardware',
        'Repeat at the designated grounding points; log both shortest and longest paths',
      ],
      clause: 'IEC 61730-2:2023 MST 13 (continuity of equipotential bonding)',
    }),
  },
  {
    id: 'gct-current-out-of-band',
    applies: ['gct'],
    when: (m) =>
      m.gctCurrentDeltaPct !== undefined && Math.abs(m.gctCurrentDeltaPct) > 10,
    make: (m) => ({
      severity: 'warning',
      title: 'Injected test current out of tolerance',
      observed: `ΔI = ${m.gctCurrentDeltaPct?.toFixed(0)} % from the 25 A setpoint.`,
      causes: ['Supply current limit reached (high loop resistance)', 'Meter shunt mis-ranged'],
      recommendations: ['Shorten/thicken test leads; verify the shunt range before re-test'],
      clause: 'IEC 61730-2:2023 MST 13 (test current)',
    }),
  },
  {
    id: 'rco-overtemp',
    applies: ['rco'],
    when: (m) => m.moduleTempMaxC !== undefined && m.moduleTempMaxC > 105,
    make: (m) => ({
      severity: 'critical',
      title: 'Module hotspot during reverse-current hold',
      observed: `Module surface peaked at ${m.moduleTempMaxC?.toFixed(0)} °C during the 1.35 × I_sc hold.`,
      causes: [
        'Localized cell/bypass path carrying the full reverse current',
        'IR camera emissivity mis-set (false high reading)',
      ],
      recommendations: [
        'Stop per safety procedure; inspect the hotspot area and J-box',
        'Verify emissivity/background settings, then repeat the hold',
      ],
      clause: 'IEC 61730-2:2023 MST 26 (reverse current overload)',
    }),
  },
  {
    id: 'rco-hold-short',
    applies: ['rco'],
    when: (m) => m.holdHours !== undefined && m.holdHours < 1,
    make: (m) => ({
      severity: 'warning',
      title: 'Reverse-current hold shorter than required',
      observed: `Hold ${(m.holdHours ?? 0 * 60).toFixed(2)} h (< 1 h minimum).`,
      causes: ['Run aborted early', 'Timer configured in minutes instead of hours'],
      recommendations: ['Repeat the full ≥1 h hold; keep the IR record for the report'],
      clause: 'IEC 61730-2:2023 MST 26 (hold duration)',
    }),
  },
];

const SEV_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2, ok: 3 };

/** Run all applicable rules; returns findings sorted most-severe first. */
export function diagnose(kind: TestKind, m: RunMetrics): Finding[] {
  const found = RULES.filter((r) => r.applies.includes(kind) && r.when(m)).map(
    (r) => ({ id: r.id, ...r.make(m) }),
  );
  if (found.length === 0) {
    return [
      {
        id: 'healthy',
        severity: 'ok',
        title: 'No anomalies detected',
        observed: 'All monitored parameters stayed within their IEC bands for this run.',
        causes: [],
        recommendations: ['Archive the run record with the protocol for the report.'],
        clause: 'Per the applicable IEC clause for this test',
      },
    ];
  }
  return found.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
}
