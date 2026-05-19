'use client';

/**
 * Pathname-derived breadcrumb trail. Labels are user-friendly mappings
 * for the segments we know about; unknown segments fall back to a
 * sentence-cased version of the raw slug.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Home } from 'lucide-react';

const LABELS: Record<string, string> = {
  overview: '360° Overview',
  dashboard: 'Tests',
  tests: 'Tests',
  equipment: 'Equipment',
  inventory: 'Inventory',
  tickets: 'Tickets',
  help: 'Help',
  troubleshooting: 'Troubleshooting',
  settings: 'Settings',
  database: 'Database',
  'power-supplies': 'Power supplies',
  admin: 'Admin',
  logs: 'Logs',
  schedule: 'Schedule',
  procurement: 'Procurement',
  rfq: 'RFQs',
  'thermal-cycling': 'Thermal Cycling (MQT 11)',
  'humidity-freeze': 'Humidity Freeze (MQT 12)',
  'damp-heat': 'Damp Heat (MQT 13)',
  'bypass-diode': 'Bypass Diode (MQT 18)',
  letid: 'LeTID (TS 63342)',
  pid: 'PID',
  'reverse-current': 'Reverse Current (MST 26)',
  'ground-continuity': 'Ground Continuity (MST 13)',
};

function label(seg: string): string {
  if (LABELS[seg]) return LABELS[seg];
  return seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function Breadcrumbs({ className }: { className?: string }) {
  const path = usePathname() ?? '/';
  const segments = path.split('/').filter(Boolean);

  return (
    <nav aria-label="Breadcrumb" className={`text-[11px] flex items-center gap-1 ${className ?? ''}`}>
      <Link
        href="/overview"
        className="inline-flex items-center gap-1 text-muted hover:text-app"
        data-testid="crumb-home"
      >
        <Home className="w-3 h-3" aria-hidden />
        <span className="sr-only">Home</span>
      </Link>
      {segments.map((seg, i) => {
        const href = '/' + segments.slice(0, i + 1).join('/');
        const isLast = i === segments.length - 1;
        return (
          <span key={href} className="inline-flex items-center gap-1">
            <ChevronRight className="w-3 h-3 text-muted" aria-hidden />
            {isLast ? (
              <span className="text-app font-medium" aria-current="page" data-testid={`crumb-current`}>
                {label(seg)}
              </span>
            ) : (
              <Link href={href} className="text-muted hover:text-app">
                {label(seg)}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
