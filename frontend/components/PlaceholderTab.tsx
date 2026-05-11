'use client';

import { Badge } from '@/components/ui/badge';
import type { LiveReading } from '@/lib/types';

interface PlaceholderTabProps {
  title: string;
  standard: string;
  description?: string;
  readings?: LiveReading[];
}

export function PlaceholderTab({
  title,
  standard,
  description,
  readings,
}: PlaceholderTabProps) {
  const latest = readings && readings.length > 0 ? readings[readings.length - 1] : null;

  return (
    <section className="flex h-full flex-col gap-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-steel-700 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-steel-50">{title}</h2>
          <p className="mt-1 text-xs text-steel-400">{description ?? 'Test runner not implemented in this build.'}</p>
        </div>
        <Badge variant="agni">{standard}</Badge>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-dashed border-steel-700 bg-panel-raised/60 p-6 shadow-inset-panel md:col-span-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-steel-300">
            Coming Soon
          </h3>
          <p className="mt-3 max-w-prose text-sm text-steel-400">
            This tab will host the run controls, charts, and pass/fail criteria for
            <span className="text-steel-200"> {title}</span>. The dashboard shell, device
            link, and data stream are already wired up so test modules can plug in here
            without further plumbing.
          </p>
          <ul className="mt-4 space-y-1 text-xs text-steel-400">
            <li>· Real-time chart of voltage / current / temperature</li>
            <li>· SCPI sequencer with start / pause / abort</li>
            <li>· Pass/fail evaluation against {standard}</li>
            <li>· Per-session report export (PDF / DOCX / CSV)</li>
          </ul>
        </div>

        <div className="rounded-lg border border-steel-700 bg-panel-raised/60 p-6 shadow-inset-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-steel-300">
            Live Telemetry
          </h3>
          {latest ? (
            <dl className="mt-4 grid grid-cols-2 gap-y-2 font-mono text-xs">
              <dt className="text-steel-400">Voltage</dt>
              <dd className="text-right text-steel-100">{latest.voltage.toFixed(2)} V</dd>
              <dt className="text-steel-400">Current</dt>
              <dd className="text-right text-steel-100">{latest.current.toFixed(2)} A</dd>
              <dt className="text-steel-400">Power</dt>
              <dd className="text-right text-steel-100">{latest.power.toFixed(3)} kW</dd>
              {latest.temperature !== undefined && (
                <>
                  <dt className="text-steel-400">Temp</dt>
                  <dd className="text-right text-steel-100">{latest.temperature.toFixed(1)} °C</dd>
                </>
              )}
            </dl>
          ) : (
            <p className="mt-4 text-xs text-steel-500">Awaiting stream…</p>
          )}
        </div>
      </div>
    </section>
  );
}

export default PlaceholderTab;
