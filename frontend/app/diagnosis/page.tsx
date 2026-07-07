'use client';

import { useState } from 'react';
import AppShell from '@/components/AppShell';
import {
  diagnose,
  type Finding,
  type RunMetrics,
  type TestKind,
} from '@/features/diagnosis/engine';

const KINDS: { key: TestKind; label: string; std: string }[] = [
  { key: 'tc',    label: 'Thermal Cycling',   std: 'IEC 61215-2:2021 MQT 11' },
  { key: 'hf',    label: 'Humidity Freeze',   std: 'IEC 61215-2:2021 MQT 12' },
  { key: 'pid',   label: 'PID',               std: 'IEC TS 62804-1' },
  { key: 'letid', label: 'LeTID',             std: 'IEC TS 63342' },
  { key: 'bdt',   label: 'Bypass Diode',      std: 'IEC 61215-2:2021 MQT 18.1' },
  { key: 'gct',   label: 'Ground Continuity', std: 'IEC 61730-2:2023 MST 13' },
  { key: 'rco',   label: 'Reverse Current',   std: 'IEC 61730-2:2023 MST 26' },
];

// Deterministic demo runs so operators can see the engine speak before it is
// fed by live session metrics: one run per test with representative faults,
// and one healthy run.
const FAULTY: Record<TestKind, RunMetrics> = {
  tc:    { worstRampCph: 138, rampCeilingCph: 100, dwellMinutes: 7, injectedCurrentDeltaPct: 3.1 },
  hf:    { rhExcursionPctMin: 74, worstRampCph: 210, rampCeilingCph: 200 },
  pid:   { leakageCurrentUa: 130, stabilizationHours: 9 },
  letid: { regenerationOnsetH: null, moduleTempC: 68 },
  bdt:   { tjMaxObservedC: 212, fitR2: 0.62 },
  gct:   { worstPathOhm: 0.14, gctCurrentDeltaPct: -14 },
  rco:   { moduleTempMaxC: 121, holdHours: 0.6 },
};

const HEALTHY: Record<TestKind, RunMetrics> = {
  tc:    { worstRampCph: 82, rampCeilingCph: 100, dwellMinutes: 14, injectedCurrentDeltaPct: 0.6 },
  hf:    { rhExcursionPctMin: 86, worstRampCph: 95, rampCeilingCph: 100 },
  pid:   { leakageCurrentUa: 8, stabilizationHours: 16 },
  letid: { regenerationOnsetH: 88, moduleTempC: 75 },
  bdt:   { tjMaxObservedC: 96, fitR2: 0.994 },
  gct:   { worstPathOhm: 0.032, gctCurrentDeltaPct: 2 },
  rco:   { moduleTempMaxC: 74, holdHours: 1.1 },
};

const SEV_STYLE: Record<Finding['severity'], string> = {
  critical: 'border-red-500/60 bg-red-500/10',
  warning:  'border-amber-500/60 bg-amber-500/10',
  info:     'border-sky-500/60 bg-sky-500/10',
  ok:       'border-emerald-500/60 bg-emerald-500/10',
};

const SEV_PILL: Record<Finding['severity'], string> = {
  critical: 'bg-red-600 text-white',
  warning:  'bg-amber-500 text-black',
  info:     'bg-sky-600 text-white',
  ok:       'bg-emerald-600 text-white',
};

export default function DiagnosisPage() {
  const [kind, setKind] = useState<TestKind>('tc');
  const [scenario, setScenario] = useState<'faulty' | 'healthy'>('faulty');

  const metrics = scenario === 'faulty' ? FAULTY[kind] : HEALTHY[kind];
  const findings = diagnose(kind, metrics);
  const std = KINDS.find((k) => k.key === kind)?.std ?? '';

  return (
    <AppShell
      title="Run Diagnosis"
      subtitle="What went wrong · probable causes · recommendations, per IEC clause"
    >
      <div className="p-6 space-y-4 max-w-4xl" data-testid="diagnosis-page">
        <div className="flex flex-wrap items-center gap-2">
          {KINDS.map((k) => (
            <button
              key={k.key}
              onClick={() => setKind(k.key)}
              title={k.std}
              className={`px-3 py-1 rounded text-xs font-medium border ${
                kind === k.key
                  ? 'bg-surface-2 text-app border-app font-semibold'
                  : 'text-muted border-transparent hover:text-app hover:bg-surface-2'
              }`}
            >
              {k.label}
            </button>
          ))}
          <span className="ml-auto inline-flex rounded border border-app overflow-hidden text-xs">
            <button
              onClick={() => setScenario('faulty')}
              className={`px-3 py-1 ${scenario === 'faulty' ? 'bg-surface-2 text-app font-semibold' : 'text-muted'}`}
            >
              Demo run (with faults)
            </button>
            <button
              onClick={() => setScenario('healthy')}
              className={`px-3 py-1 ${scenario === 'healthy' ? 'bg-surface-2 text-app font-semibold' : 'text-muted'}`}
            >
              Healthy run
            </button>
          </span>
        </div>

        <p className="text-[11px] text-muted">
          Standard: <span className="text-app">{std}</span> · analysing a
          deterministic demo run — live sessions feed the same engine as their
          metrics land in the Data Table.
        </p>

        <div className="space-y-3">
          {findings.map((f) => (
            <article key={f.id} className={`rounded-lg border p-4 space-y-2 ${SEV_STYLE[f.severity]}`}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-app">{f.title}</h2>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${SEV_PILL[f.severity]}`}>
                  {f.severity}
                </span>
              </div>
              <p className="text-xs text-app">{f.observed}</p>
              {f.causes.length > 0 && (
                <div>
                  <h3 className="text-[10px] uppercase tracking-wide text-muted">Possible causes</h3>
                  <ul className="list-disc pl-5 text-xs text-app space-y-0.5">
                    {f.causes.map((c) => <li key={c}>{c}</li>)}
                  </ul>
                </div>
              )}
              <div>
                <h3 className="text-[10px] uppercase tracking-wide text-muted">Recommendations</h3>
                <ul className="list-disc pl-5 text-xs text-app space-y-0.5">
                  {f.recommendations.map((r) => <li key={r}>{r}</li>)}
                </ul>
              </div>
              <p className="text-[10px] text-muted">Clause: {f.clause}</p>
            </article>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
