'use client';

/**
 * G17 — Mode-specific view wrappers for Live Monitor, Data Table,
 * Analysis, and Report sub-tabs.
 *
 * The dashboard's existing sub-tab content is unchanged for the
 * `ivPsuScope` mode (the historical default) so the WS-stream gauges and
 * charts keep working. The other two modes get lighter-weight surfaces:
 *
 *   iv4q        — step-by-step list (SMU drives the sweep)
 *   ivImport    — plot-only (no live gauges)
 */
import LiveChart from './LiveChart';
import { IV_MODE_LABELS, type IvMode } from '@/lib/iv-mode-store';
import type { LiveReading } from '@/types/test-session';

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

const FOUR_Q_STEPS: ReadonlyArray<string> = [
  'Verify SMU 4-wire leads to module terminals.',
  'Forward sweep (V- → V+) at configured step size.',
  'Reverse sweep (V+ → V-) — quadrant 3/4 capture.',
  'Stitch quadrants → unified I-V curve.',
];

interface MonitorProps {
  mode: IvMode;
  readings: LiveReading[];
  defaultView: React.ReactNode;
}

export function IvModeMonitor({ mode, readings, defaultView }: MonitorProps): React.ReactElement {
  if (mode === 'iv4q') {
    return (
      <div data-testid="iv-monitor-iv4q" className="space-y-3 max-w-2xl">
        <h4 className="text-sm font-semibold text-orange-300">4-Quadrant SMU — step-by-step capture</h4>
        <ol className="text-xs text-gray-300 space-y-1 list-decimal pl-5">
          {FOUR_Q_STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <div className="text-[10px] text-gray-500">
          The SMU drives the sweep; the PSU output remains OFF for the duration of the capture.
        </div>
      </div>
    );
  }

  if (mode === 'ivImport') {
    return (
      <div data-testid="iv-monitor-ivImport" className="space-y-3">
        <h4 className="text-sm font-semibold text-orange-300">Offline Import — plot only</h4>
        <LiveChart readings={readings} metric="power" color="#f59e0b" label="Imported I-V (Power)" />
        <p className="text-[10px] text-gray-500">
          Re-upload a workbook on the Setup tab to refresh the trace. No live acquisition.
        </p>
      </div>
    );
  }

  // ivPsuScope — preserve the existing live-monitor layout.
  return <div data-testid="iv-monitor-ivPsuScope">{defaultView}</div>;
}
