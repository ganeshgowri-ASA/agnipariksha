/**
 * EL Analysis pane — IEC TS 60904-13.
 *
 * Renders KPIs + a low-fidelity grid view of the EL frame with
 * inactive/defect cells highlighted. In DEMO mode it generates a
 * synthetic frame; in LIVE mode the camera capture pipeline (stub)
 * would emit ElFrame payloads on the WS stream — left for the
 * capture-pipeline PR to wire in.
 */
'use client';

import { useMemo } from 'react';
import {
  computeElKpis, generateDemoFrame, EL_CONSTANTS,
  type Verdict, type ElKpis, type ElFrame,
} from './elAnalysis';

interface Props {
  /** Optional live frame from the capture pipeline. */
  frame?: ElFrame | null;
  /** Injection current — drives the synthetic DEMO frame. */
  injectionCurrent: number;
  /** Operator chose DEMO mode (used to gate auto-synth). */
  demoMode: boolean;
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

export default function ElAnalysisPanel({ frame, injectionCurrent, demoMode }: Props) {
  const effectiveFrame = useMemo<ElFrame | null>(() => {
    if (frame) return frame;
    if (demoMode) return generateDemoFrame(DEMO_CELLS_X, DEMO_CELLS_Y, injectionCurrent);
    return null;
  }, [frame, injectionCurrent, demoMode]);

  const kpis = useMemo(() => computeElKpis(effectiveFrame), [effectiveFrame]);

  if (effectiveFrame === null) {
    return (
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
