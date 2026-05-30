/**
 * EL Analysis pane — IEC TS 60904-13 + IEA PVPS Task 13.
 *
 * Renders KPIs + a low-fidelity grid view of the EL frame with
 * inactive/defect cells highlighted. In DEMO mode it generates a
 * synthetic frame; in LIVE mode the camera capture pipeline (stub)
 * would emit ElFrame payloads on the WS stream — left for the
 * capture-pipeline PR to wire in.
 *
 * On top of the raw KPIs this pane computes the IEA PVPS Task 13 DEFECT
 * INDEX (0–100) and an A/B/C grade, with a selectable DEFAULT vs MBJ
 * criteria mode (stricter thresholds), and a full metadata block
 * (camera / injection current / PSU settings) surfaced for the report.
 */
'use client';

import { useMemo, useState } from 'react';
import {
  computeElKpis, generateDemoFrame, EL_CONSTANTS,
  type Verdict, type ElKpis, type ElFrame,
} from './elAnalysis';
import {
  computeDefectIndex, classifyDefectIndex, describeGrade, DEFECT_THRESHOLDS,
  type DefectInput, type DefectGrade, type DefectCriteriaMode,
} from './defectIndex';

/**
 * Acquisition metadata shown on the EL view and carried into the report.
 * Defined locally so this pane does not depend on any in-flight metadata
 * branch — the capture pipeline can populate it from the camera SDK + PSU
 * telemetry, or ELTab supplies operator setpoints as a fallback.
 */
export interface ElMetadata {
  /** Camera model string (e.g. "ITECH IR-EL 12MP"). */
  cameraModel: string;
  /** Camera exposure time (s). */
  exposureSec: number;
  /** Forward-bias injection current at capture (A). */
  injectionCurrentA: number;
  /** PSU programmed voltage setpoint (V). */
  psuVoltageV: number;
  /** PSU programmed current limit (A). */
  psuCurrentA: number;
}

interface Props {
  /** Optional live frame from the capture pipeline. */
  frame?: ElFrame | null;
  /** Injection current — drives the synthetic DEMO frame. */
  injectionCurrent: number;
  /** Operator chose DEMO mode (used to gate auto-synth). */
  demoMode: boolean;
  /**
   * Per-class defect counts (IEA PVPS Task 13). When omitted the pane
   * derives a demo DefectInput from the computed KPIs so reviewers see a
   * meaningful index without a classifier wired in.
   */
  defects?: DefectInput;
  /** Acquisition metadata (camera / current / PSU) for the view + report. */
  metadata?: ElMetadata;
}

const DEMO_CELLS_X = 6;
const DEMO_CELLS_Y = 10;

function verdictColors(v: Verdict): { bg: string; ring: string; text: string } {
  switch (v) {
    case 'pass':    return { bg: 'bg-green-900/30', ring: 'ring-green-500/40', text: 'text-green-300' };
    case 'warn':    return { bg: 'bg-amber-900/30', ring: 'ring-amber-500/40', text: 'text-amber-300' };
    case 'fail':    return { bg: 'bg-red-900/30',   ring: 'ring-red-500/40',   text: 'text-red-300'   };
    case 'pending': return { bg: 'bg-gray-800',     ring: 'ring-gray-600/40',  text: 'text-gray-400'  };
  }
}

function gradeColors(g: DefectGrade): { bg: string; ring: string; text: string } {
  switch (g) {
    case 'A': return { bg: 'bg-green-900/30', ring: 'ring-green-500/40', text: 'text-green-300' };
    case 'B': return { bg: 'bg-amber-900/30', ring: 'ring-amber-500/40', text: 'text-amber-300' };
    case 'C': return { bg: 'bg-red-900/30',   ring: 'ring-red-500/40',   text: 'text-red-300'   };
  }
}

/**
 * Derive a demo DefectInput from the computed KPIs so the index is
 * meaningful before a real Task-13 classifier is wired in: inactive cells
 * are graded as severe (Class C), gradient defects as moderate (Class B),
 * and the inactive-area fraction feeds the area term.
 */
function deriveDemoDefects(kpis: ElKpis): DefectInput {
  return {
    classA: 0,
    classB: kpis.defectCells,
    classC: kpis.inactiveCells,
    areaFraction: Math.min(1, kpis.inactivePct / 100),
  };
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-2xl font-bold text-gray-100 mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function VerdictTriple({ kpis }: { kpis: ElKpis }) {
  const items: Array<{ label: string; v: Verdict; sub: string }> = [
    {
      label: 'Mean intensity',
      v: kpis.meanIntensityVerdict,
      sub: `${kpis.meanIntensity.toFixed(3)} / ≥${EL_CONSTANTS.MEAN_INTENSITY_MIN}`,
    },
    {
      label: 'Inactive cells',
      v: kpis.inactiveVerdict,
      sub: `${kpis.inactiveCells} (${kpis.inactivePct.toFixed(2)}%) · ≤${EL_CONSTANTS.MAX_INACTIVE_PCT}%`,
    },
    {
      label: 'Defects (gradient)',
      v: kpis.defectVerdict,
      sub: `${kpis.defectCells} (${kpis.defectPct.toFixed(2)}%)`,
    },
  ];
  return (
    <div className="grid grid-cols-3 gap-3">
      {items.map((it) => {
        const c = verdictColors(it.v);
        return (
          <div key={it.label} className={`rounded-lg ${c.bg} ring-1 ${c.ring} px-3 py-2`}>
            <div className={`text-xs font-medium ${c.text}`}>{it.label}</div>
            <div className={`text-[11px] mt-0.5 ${c.text} opacity-80 tabular-nums`}>{it.sub}</div>
            <div className={`text-[10px] mt-1 uppercase font-bold ${c.text}`}>{it.v}</div>
          </div>
        );
      })}
    </div>
  );
}

function OverallPill({ kpis }: { kpis: ElKpis }) {
  const c = verdictColors(kpis.overallVerdict);
  const label =
    kpis.overallVerdict === 'pending' ? 'No frame yet'
    : kpis.overallVerdict === 'pass'  ? 'PASS — TS 60904-13 image OK'
    : kpis.overallVerdict === 'warn'  ? 'WARN — review inactive / defects'
    : 'FAIL — TS 60904-13 thresholds exceeded';
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${c.bg} ring-1 ${c.ring} ${c.text} text-xs font-medium`}>
      <span className="font-mono">TS 60904-13</span>
      <span>{label}</span>
    </div>
  );
}

/** A/B/C grade pill driven by the DEFECT INDEX + active criteria mode. */
function GradePill({ grade, mode }: { grade: DefectGrade; mode: DefectCriteriaMode }) {
  const c = gradeColors(grade);
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${c.bg} ring-1 ${c.ring} ${c.text} text-xs font-medium`}>
      <span className="font-mono">IEA PVPS T13</span>
      <span>{describeGrade(grade, mode)}</span>
    </div>
  );
}

/** DEFAULT ⇄ MBJ criteria-mode toggle. */
function MbjToggle({ mode, onChange }: { mode: DefectCriteriaMode; onChange: (m: DefectCriteriaMode) => void }) {
  const modes: Array<{ key: DefectCriteriaMode; label: string }> = [
    { key: 'default', label: 'IEC default' },
    { key: 'mbj', label: 'MBJ strict' },
  ];
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-gray-800 border border-gray-700 p-0.5">
      {modes.map((m) => (
        <button
          key={m.key}
          type="button"
          onClick={() => onChange(m.key)}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
            mode === m.key ? 'bg-sky-600 text-white' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Acquisition metadata block — camera, injection current and PSU settings.
 * Shown on the EL view and consumable by the report builder.
 */
function MetadataBlock({ meta }: { meta: ElMetadata }) {
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Camera', value: meta.cameraModel },
    { label: 'Exposure', value: `${meta.exposureSec.toFixed(0)} s` },
    { label: 'Injection current', value: `${meta.injectionCurrentA.toFixed(2)} A` },
    { label: 'PSU voltage', value: `${meta.psuVoltageV.toFixed(1)} V` },
    { label: 'PSU current limit', value: `${meta.psuCurrentA.toFixed(2)} A` },
  ];
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-200">Acquisition metadata</h3>
        <span className="text-[10px] text-gray-500 font-mono">IEC TS 60904-13 §6 (camera/PSU)</span>
      </div>
      <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">
        {rows.map((r) => (
          <div key={r.label}>
            <dt className="text-[10px] uppercase tracking-wide text-gray-500">{r.label}</dt>
            <dd className="text-sm text-gray-200 tabular-nums">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CellGrid({ frame, kpis }: { frame: ElFrame; kpis: ElKpis }) {
  // Mark cells: inactive (red), defect (amber), normal (jet colormap).
  const inactiveSet = new Set(kpis.inactiveIdx);
  const defectSet = new Set(kpis.defectIdx);
  const cells = frame.intensities.map((v, i) => {
    let bg: string;
    if (inactiveSet.has(i)) bg = '#dc2626'; // red — dead
    else if (defectSet.has(i)) bg = '#f59e0b'; // amber — defect
    else {
      // grayscale jet-ish: dark = low EL, bright orange-yellow = high
      const g = Math.round(v * 220);
      bg = `rgb(${g}, ${Math.round(g * 0.7)}, ${Math.round(g * 0.25)})`;
    }
    return { i, bg };
  });
  return (
    <div className="grid gap-[2px] mx-auto"
      style={{
        gridTemplateColumns: `repeat(${frame.cellsX}, 24px)`,
        gridTemplateRows: `repeat(${frame.cellsY}, 24px)`,
      }}>
      {cells.map(({ i, bg }) => (
        <div key={i} title={`cell ${i} = ${frame.intensities[i].toFixed(2)}`}
          className="rounded-sm" style={{ background: bg }} />
      ))}
    </div>
  );
}

export default function ElAnalysisPanel({ frame, injectionCurrent, demoMode, defects, metadata }: Props) {
  const [criteriaMode, setCriteriaMode] = useState<DefectCriteriaMode>('default');

  const effectiveFrame = useMemo<ElFrame | null>(() => {
    if (frame) return frame;
    if (demoMode) return generateDemoFrame(DEMO_CELLS_X, DEMO_CELLS_Y, injectionCurrent);
    return null;
  }, [frame, injectionCurrent, demoMode]);

  const kpis = useMemo(() => computeElKpis(effectiveFrame), [effectiveFrame]);

  // Defect inputs: operator/classifier-supplied, else derived from KPIs.
  const defectInput = useMemo<DefectInput>(
    () => defects ?? deriveDemoDefects(kpis),
    [defects, kpis],
  );
  const defectResult = useMemo(() => computeDefectIndex(defectInput), [defectInput]);
  const grade = useMemo(
    () => classifyDefectIndex(defectResult.index, criteriaMode),
    [defectResult.index, criteriaMode],
  );

  // Metadata: live capture/PSU telemetry if provided, else operator setpoints.
  const meta: ElMetadata = metadata ?? {
    cameraModel: 'Demo cooled-CMOS (1 MP)',
    exposureSec: effectiveFrame?.exposureSec ?? 10,
    injectionCurrentA: effectiveFrame?.injectionCurrent ?? injectionCurrent,
    psuVoltageV: 0,
    psuCurrentA: effectiveFrame?.injectionCurrent ?? injectionCurrent,
  };

  if (effectiveFrame === null) {
    return (
      <div className="space-y-4">
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
          <p className="text-sm text-gray-400">
            No EL frame captured yet. Start an EL run (or switch to DEMO) — the
            capture pipeline will emit an ElFrame once the camera exposure
            completes.
          </p>
          <p className="text-xs text-gray-500 mt-3">
            IEC TS 60904-13 · forward-bias injection {injectionCurrent.toFixed(1)} A
          </p>
        </div>
        <MetadataBlock meta={meta} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Cells" value={`${effectiveFrame.cellsX}×${effectiveFrame.cellsY}`} sub={`${effectiveFrame.intensities.length} total`} />
        <KpiCard label="Mean intensity" value={kpis.meanIntensity.toFixed(3)} sub={`σ = ${kpis.stdDev.toFixed(3)}`} />
        <KpiCard label="Inactive" value={`${kpis.inactiveCells}`} sub={`${kpis.inactivePct.toFixed(2)} %`} />
        <KpiCard label="Defects" value={`${kpis.defectCells}`} sub={`${kpis.defectPct.toFixed(2)} %`} />
      </div>

      <VerdictTriple kpis={kpis} />
      <OverallPill kpis={kpis} />

      {/* IEA PVPS Task 13 DEFECT INDEX + A/B/C grade + criteria-mode toggle. */}
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-200">Defect index &amp; grade</h3>
          <MbjToggle mode={criteriaMode} onChange={setCriteriaMode} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-center">
          <KpiCard
            label="Defect index"
            value={defectResult.index.toFixed(1)}
            sub="0 pristine · 100 degraded"
          />
          <KpiCard
            label="Severity counts"
            value={`${defectInput.classB + defectInput.classC}`}
            sub={`B ${defectInput.classB} · C ${defectInput.classC}`}
          />
          <KpiCard
            label="Affected area"
            value={`${(defectInput.areaFraction * 100).toFixed(1)} %`}
            sub={`area term ${defectResult.areaComponent.toFixed(1)}`}
          />
          <div className="flex flex-col items-start gap-1">
            <GradePill grade={grade} mode={criteriaMode} />
            <span className="text-[10px] text-gray-500 font-mono">
              A ≤ {DEFECT_THRESHOLDS[criteriaMode].aMax} · B ≤ {DEFECT_THRESHOLDS[criteriaMode].bMax} · then C
            </span>
          </div>
        </div>
      </div>

      <MetadataBlock meta={meta} />

      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-200">EL frame ({effectiveFrame.cellsX}×{effectiveFrame.cellsY} cells)</h3>
          <span className="text-[10px] text-gray-500 font-mono">IEC TS 60904-13 · {effectiveFrame.exposureSec} s</span>
        </div>
        <div className="flex justify-center">
          <CellGrid frame={effectiveFrame} kpis={kpis} />
        </div>
        <div className="mt-3 text-[10px] text-gray-500 text-center space-x-3">
          <span><span className="inline-block w-2 h-2 align-middle rounded-sm" style={{ background: '#dc2626' }} /> inactive</span>
          <span><span className="inline-block w-2 h-2 align-middle rounded-sm" style={{ background: '#f59e0b' }} /> defect</span>
          <span><span className="inline-block w-2 h-2 align-middle rounded-sm" style={{ background: 'rgb(170,119,42)' }} /> normal</span>
        </div>
      </div>
    </div>
  );
}
