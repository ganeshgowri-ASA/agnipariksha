/**
 * Troubleshooting landing page — populated by the dedicated
 * `feat/troubleshooting-guide` branch. This stub gives the nav target a
 * 200 response, lays out the planned sections, and surfaces a stable
 * URL the rest of the chrome can link to in the meantime.
 */
import AppShell from '@/components/AppShell';
import Link from 'next/link';

const SECTIONS = [
  {
    id: 'connection-failures',
    title: 'Connection failures',
    bullets: [
      'ITECH PV6000 unreachable at 192.168.200.100:30000 — check VLAN, cable, and front-panel REM/LOC.',
      '“Python was not found” on Windows — re-run `deploy.sh`; the new launcher prefers `python3` over the App-Execution-Alias stub.',
      'WebSocket disconnect — verify `/api/health` reports SCPI reachable; check firewall on port 8000.',
    ],
  },
  {
    id: 'calibration-drift',
    title: 'Calibration drift',
    bullets: [
      'DMM > 12 days since last cal: schedule via /schedule.',
      'Voltage offset > 0.05 V STC: rerun two-point calibration with the reference cell.',
    ],
  },
  {
    id: 'watchdog-trips',
    title: 'Watchdog trips',
    bullets: [
      '2 s telemetry silence trips the safety interlock; output is forced OFF (OUTP OFF) and the chamber transitions to safe state.',
      'Recover via E-STOP release → SYST:LOC → fresh /api/tests/{id}/control start.',
    ],
  },
  {
    id: 'vf-temperature',
    title: 'Vf-temperature anomaly (bypass diode)',
    bullets: [
      'If Tj rises faster than -2 mV/°C predicts, double-check thermocouple bonding to the diode body — not the cell sheet.',
      'Forward voltage drift of >10% during the 1 h soak almost always means the diode is failing — flag for replacement.',
    ],
  },
  {
    id: 'pmax-fit',
    title: 'Pmax fit failures',
    bullets: [
      'IV sweep returned <12 points — extend sweep window or reduce noise floor.',
      'Two local maxima detected — re-run with finer step around Vmpp; report the higher of the two.',
    ],
  },
  {
    id: 'scpi-errors',
    title: 'Common ITECH SYST:ERR? codes',
    bullets: [
      '-113 Undefined header — verify the command verb against IT9000-PV6000 §3.',
      '-222 Data out of range — clamp to module Voc / Isc and retry.',
      '-410 Query INTERRUPTED — host queried before the prior MEAS:* completed; pace with `*OPC?`.',
    ],
  },
];

export const metadata = {
  title: 'Troubleshooting — Agnipariksha',
};

export default function TroubleshootingPage() {
  return (
    <AppShell
      title="Troubleshooting"
      subtitle="Common failure modes pulled from the IT9000-PV6000 manual and the lessons-log."
    >
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <nav aria-label="On this page" className="border border-app rounded bg-surface p-3">
          <p className="text-[11px] uppercase tracking-wider text-muted mb-1">On this page</p>
          <ul className="grid grid-cols-2 md:grid-cols-3 gap-1 text-xs">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-app hover:text-orange-300">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {SECTIONS.map((s) => (
          <section key={s.id} id={s.id} className="border border-app rounded bg-surface p-4">
            <h3 className="text-sm font-bold text-app mb-2">{s.title}</h3>
            <ul className="list-disc pl-5 space-y-1 text-xs text-app">
              {s.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </section>
        ))}

        <p className="text-[11px] text-muted">
          A richer write-up lands with{' '}
          <Link href="https://github.com/ganeshgowri-ASA/agnipariksha/labels/feat%2Ftroubleshooting-guide" className="underline">
            <code className="font-mono">feat/troubleshooting-guide</code>
          </Link>
          {' '}— this stub keeps the link target alive in the interim.
        </p>
      </div>
    </AppShell>
  );
}
