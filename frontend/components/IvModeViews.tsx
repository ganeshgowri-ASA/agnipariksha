'use client';

/**
 * G17 — Mode indicator banner for the Live Monitor / Data Table /
 * Analysis / Report sub-tabs.
 *
 * The four downstream tabs read the active IV mode (set on the Setup
 * tab) and surface it via this small banner so operators see which
 * capture pipeline is driving the panel they're looking at. Full
 * mode-specific view swaps (step-by-step list for 4q, plot-only for
 * import) are intentionally deferred to a follow-up — wiring the read
 * path first keeps the diff minimal and avoids touching the existing
 * gauges + charts rendering used by other tests.
 */
import { IV_MODE_LABELS, type IvMode } from '@/lib/iv-mode-store';

export function IvModeBanner({ mode }: { mode: IvMode }): React.ReactElement {
  return (
    <div
      data-testid={`iv-mode-banner-${mode}`}
      className="mb-3 text-[11px] text-orange-300 bg-orange-900/20 border border-orange-700/40 px-2 py-1 rounded inline-block"
    >
      IV mode: <span className="font-semibold">{IV_MODE_LABELS[mode]}</span>
    </div>
  );
}
