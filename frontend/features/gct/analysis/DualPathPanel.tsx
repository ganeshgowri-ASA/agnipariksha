/**
 * Dual-path Ground/Equipotential continuity panel — IEC 61730-2 MST 13.
 *
 * MST 13 grades the resistance between exposed conductive parts and the
 * main grounding terminal. This panel captures BOTH the shortest and the
 * longest conductive path measured in a run, plus the injected frame
 * current, and renders:
 *
 *   • Editable readouts for shortest-R, longest-R and injected current
 *   • A context selector (COP / DPTT / LeTID / IDD) attributing the log
 *     to the calling sequence — shown in the verdict + report
 *   • A per-path CONFORM / NON-CONFORM pill (R < 0.1 Ω) with clause ref
 *   • A frame-current in-band pill (25 A ± band)
 *   • An overall NON-CONFORM banner (red when either path or the current
 *     is out of spec)
 *
 * All grading is delegated to the pure functions in ./dualPath so the UI,
 * the vitest suite, and the backend orchestrator stay in lock-step. Mirrors
 * the visual language of TcAnalysisPanel.
 */
'use client';

import { useMemo, useState } from 'react';
import {
  pathResistanceVerdict,
  frameCurrentInBand,
  dualPathVerdict,
  DUAL_PATH_CONSTANTS,
  FRAME_CURRENT_MIN_A,
  FRAME_CURRENT_MAX_A,
  GC_CONTEXTS,
  GC_CONTEXT_LABELS,
  type GcContext,
  type PathVerdict,
} from './dualPath';

interface Props {
  /** Seed for the shortest-path resistance readout (Ω), if measured upstream. */
  initialShortestR?: number | null;
  /** Seed for the longest-path resistance readout (Ω), if measured upstream. */
  initialLongestR?: number | null;
  /** Seed for the injected frame current (A). Defaults to the 25 A nominal. */
  initialInjectedA?: number | null;
  /** Default attribution context for the dual-path log. */
  initialContext?: GcContext;
}

function parseNullable(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function PathVerdictPill({ label, r }: { label: string; r: number | null }) {
  const v: PathVerdict | 'pending' = r === null ? 'pending' : pathResistanceVerdict(r);
  const cls =
    v === 'conform'
      ? 'bg-green-900/30 ring-green-500/40 text-green-300'
      : v === 'non-conform'
        ? 'bg-red-900/30 ring-red-500/40 text-red-300'
        : 'bg-gray-800 ring-gray-600/40 text-gray-400';
  const txt =
    v === 'conform'
      ? `CONFORM — < ${DUAL_PATH_CONSTANTS.MST13_MAX_R_OHM} Ω`
      : v === 'non-conform'
        ? `NON-CONFORM — ≥ ${DUAL_PATH_CONSTANTS.MST13_MAX_R_OHM} Ω`
        : 'Pending';
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ring-1 ${cls} text-xs font-medium`}>
      <span className="font-mono">MST 13</span>
      <span>{label}</span>
      <span>{txt}</span>
      <span className="opacity-70 tabular-nums">· {r === null ? '—' : `${r.toFixed(4)} Ω`}</span>
    </div>
  );
}

export default function DualPathPanel({
  initialShortestR = null,
  initialLongestR = null,
  initialInjectedA = DUAL_PATH_CONSTANTS.NOMINAL_FRAME_CURRENT_A,
  initialContext = 'COP',
}: Props) {
  const [shortestStr, setShortestStr] = useState(
    initialShortestR === null ? '' : String(initialShortestR),
  );
  const [longestStr, setLongestStr] = useState(
    initialLongestR === null ? '' : String(initialLongestR),
  );
  const [injectedStr, setInjectedStr] = useState(
    initialInjectedA === null ? '' : String(initialInjectedA),
  );
  const [context, setContext] = useState<GcContext>(initialContext);

  const shortestR = parseNullable(shortestStr);
  const longestR = parseNullable(longestStr);
  const injectedA = parseNullable(injectedStr);

  const overall = useMemo(
    () => dualPathVerdict({ shortestR, longestR, injectedA }),
    [shortestR, longestR, injectedA],
  );
  const currentOk = injectedA === null ? null : frameCurrentInBand(injectedA);

  const bannerCls =
    overall === 'conform'
      ? 'border-green-700/40 bg-green-900/20'
      : overall === 'non-conform'
        ? 'border-red-700/40 bg-red-900/20'
        : 'border-gray-700 bg-gray-900';
  const bannerText =
    overall === 'conform'
      ? 'text-green-300'
      : overall === 'non-conform'
        ? 'text-red-300'
        : 'text-gray-400';

  const fields: Array<{ label: string; value: string; set: (s: string) => void; unit: string; ph: string }> = [
    { label: 'Shortest-path R', value: shortestStr, set: setShortestStr, unit: 'Ω', ph: 'e.g. 0.038' },
    { label: 'Longest-path R', value: longestStr, set: setLongestStr, unit: 'Ω', ph: 'e.g. 0.094' },
    { label: 'Injected frame current', value: injectedStr, set: setInjectedStr, unit: 'A', ph: 'e.g. 25' },
  ];

  return (
    <div className="space-y-4 max-w-3xl" data-testid="gct-dual-path">
      <div className={`rounded-lg border p-4 ${bannerCls}`} data-testid="gct-dual-path-verdict">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-green-400">Dual-path Ground Continuity — Module Verdict</h3>
          <span className="text-[10px] text-gray-500 font-mono">IEC 61730-2 MST 13</span>
        </div>
        <p className={`text-lg font-bold mt-1 ${bannerText}`}>
          {overall === 'conform' ? 'CONFORM' : overall === 'non-conform' ? 'NON-CONFORM' : 'PENDING'}
        </p>
        <p className="text-xs text-gray-400 mt-1">
          Shortest AND longest path must be &lt; {DUAL_PATH_CONSTANTS.MST13_MAX_R_OHM} Ω and the injected
          current must stay within {FRAME_CURRENT_MIN_A.toFixed(1)}–{FRAME_CURRENT_MAX_A.toFixed(1)} A
          ({DUAL_PATH_CONSTANTS.NOMINAL_FRAME_CURRENT_A} A ±
          {(DUAL_PATH_CONSTANTS.FRAME_CURRENT_TOL_FRAC * 100).toFixed(0)}%). Either out of spec → NON-CONFORM.
        </p>
        <p className="text-[11px] text-gray-500 mt-1">
          Context: <span className="font-mono text-gray-300">{context}</span> — {GC_CONTEXT_LABELS[context]}
        </p>
      </div>

      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {fields.map((f) => (
            <div key={f.label}>
              <label className="text-xs text-gray-400 block mb-1">{f.label} ({f.unit})</label>
              <input
                type="number"
                inputMode="decimal"
                value={f.value}
                placeholder={f.ph}
                onChange={(e) => f.set(e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200"
              />
            </div>
          ))}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Context</label>
            <select
              value={context}
              onChange={(e) => setContext(e.target.value as GcContext)}
              data-testid="gct-dual-path-context"
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200"
            >
              {GC_CONTEXTS.map((c) => (
                <option key={c} value={c}>
                  {c} — {GC_CONTEXT_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          <PathVerdictPill label="Shortest path" r={shortestR} />
          <PathVerdictPill label="Longest path" r={longestR} />
          <div
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
              currentOk === null
                ? 'bg-gray-800 text-gray-400'
                : currentOk
                  ? 'bg-green-900/30 text-green-300'
                  : 'bg-red-900/30 text-red-300'
            }`}
          >
            <span className="font-mono">MST 13</span>
            <span>Frame current</span>
            <span>
              {currentOk === null
                ? 'Pending'
                : currentOk
                  ? `IN BAND (${FRAME_CURRENT_MIN_A.toFixed(1)}–${FRAME_CURRENT_MAX_A.toFixed(1)} A)`
                  : `OUT OF BAND (${FRAME_CURRENT_MIN_A.toFixed(1)}–${FRAME_CURRENT_MAX_A.toFixed(1)} A)`}
            </span>
            <span className="opacity-70 tabular-nums">· {injectedA === null ? '—' : `${injectedA.toFixed(2)} A`}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
