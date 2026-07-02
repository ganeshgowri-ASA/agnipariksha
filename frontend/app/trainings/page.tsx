'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { PlayCircle, CheckSquare, Wrench } from 'lucide-react';

// Self-paced operator training. Video slots are placeholders wired for the
// lab's recorded sessions (drop MP4 links into VIDEO_URLS as they are
// recorded); checklists persist per-browser so an operator can resume.

const MODULES = [
  { id: 'psu-101',   title: 'PSU basics — front panel, DEMO vs LIVE, E-stop',        mins: 12 },
  { id: 'psu-scpi',  title: 'Remote control — SCPI over TCP, setpoints, protections', mins: 18 },
  { id: 'tc-run',    title: 'Running MQT 11 Thermal Cycling end-to-end',              mins: 22 },
  { id: 'hf-run',    title: 'Running MQT 12 Humidity Freeze + ramp selection',        mins: 17 },
  { id: 'bdt-run',   title: 'MQT 18.1 Bypass Diode — TC bonding & V_D sweep',         mins: 15 },
  { id: 'trouble',   title: 'Troubleshooting — using the Diagnosis page',             mins: 14 },
];

const VIDEO_URLS: Record<string, string | null> = Object.fromEntries(
  MODULES.map((m) => [m.id, null]), // recorded sessions land here
);

const CHECKLISTS: { id: string; title: string; items: string[] }[] = [
  {
    id: 'daily-op',
    title: 'Daily operating checklist (before first run)',
    items: [
      'E-stop reachable and tested (LIVE only)',
      'PSU vents clear; fan audible at power-on',
      'Leads torqued; 4-wire sense connected at the module',
      'Backend /health OK and mode (DEMO/LIVE) confirmed on the dashboard',
      'Chamber water reservoir level OK (HF/DH days)',
    ],
  },
  {
    id: 'shutdown',
    title: 'End-of-shift shutdown & handover',
    items: [
      'All outputs OFF; verify 0 V / 0 A on the PSU console',
      'Active runs annotated in the session log',
      'Open roadblocks recorded on the Overview handover card',
      'Chamber doors closed; alarms acknowledged',
    ],
  },
];

const PM_SCHEDULE = [
  { item: 'PSU fan filter clean',            every: 'Monthly',    last: '—' },
  { item: 'Lead/lug torque check',           every: 'Monthly',    last: '—' },
  { item: 'PSU calibration (V/I readback)',  every: '12 months',  last: '—' },
  { item: 'Chamber humidity sensor cal',     every: '6 months',   last: '—' },
  { item: 'E-stop functional test',          every: 'Quarterly',  last: '—' },
  { item: 'DMM (34465A) calibration',        every: '12 months',  last: '—' },
];

function useChecked(key: string) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setChecked(JSON.parse(raw));
    } catch { /* fresh browser */ }
  }, [key]);
  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  return { checked, toggle };
}

export default function TrainingsPage() {
  const { checked, toggle } = useChecked('agni-training-progress');

  return (
    <AppShell title="Trainings" subtitle="Self-paced modules · checklists · preventive maintenance">
      <div className="p-6 space-y-8 max-w-4xl">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-app flex items-center gap-2">
            <PlayCircle className="w-4 h-4" aria-hidden /> Self-paced modules
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {MODULES.map((m) => (
              <article key={m.id} className="rounded-lg border border-app bg-surface p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm text-app">{m.title}</h3>
                  <span className="text-[10px] text-muted whitespace-nowrap">{m.mins} min</span>
                </div>
                {VIDEO_URLS[m.id] ? (
                  <video controls className="w-full rounded" src={VIDEO_URLS[m.id] as string} />
                ) : (
                  <div className="h-24 rounded bg-surface-2 border border-dashed border-app grid place-items-center text-[11px] text-muted">
                    Recording slot — video will appear here once uploaded
                  </div>
                )}
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={!!checked[m.id]}
                    onChange={() => toggle(m.id)}
                  />
                  Mark completed
                </label>
              </article>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-app flex items-center gap-2">
            <CheckSquare className="w-4 h-4" aria-hidden /> Operating checklists
          </h2>
          {CHECKLISTS.map((cl) => (
            <article key={cl.id} className="rounded-lg border border-app bg-surface p-4">
              <h3 className="text-xs font-semibold text-app mb-2">{cl.title}</h3>
              <ul className="space-y-1">
                {cl.items.map((item, i) => {
                  const key = `${cl.id}-${i}`;
                  return (
                    <li key={key}>
                      <label className="flex items-center gap-2 text-xs text-app">
                        <input type="checkbox" checked={!!checked[key]} onChange={() => toggle(key)} />
                        <span className={checked[key] ? 'line-through text-muted' : ''}>{item}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </article>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-app flex items-center gap-2">
            <Wrench className="w-4 h-4" aria-hidden /> Preventive-maintenance schedule
          </h2>
          <table className="w-full text-sm text-app border-collapse">
            <thead>
              <tr className="text-left bg-surface-2">
                <th className="p-2">Item</th>
                <th className="p-2">Interval</th>
                <th className="p-2">Last done</th>
              </tr>
            </thead>
            <tbody>
              {PM_SCHEDULE.map((r) => (
                <tr key={r.item} className="border-b border-app">
                  <td className="p-2">{r.item}</td>
                  <td className="p-2">{r.every}</td>
                  <td className="p-2 text-muted">{r.last}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-muted">
            Log completed PM as tickets — MTBF/MTTR on the Equipment page is
            computed from that maintenance history.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
