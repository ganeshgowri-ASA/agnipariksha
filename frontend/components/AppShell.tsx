'use client';

/**
 * Page chrome shared by every route except the legacy tabbed
 * /dashboard (which has its own AppHeader). Provides:
 *   - brand bar + breadcrumbs
 *   - global navigation buttons
 *   - theme toggle
 *   - shortcuts hint
 *   - skip-to-content link for keyboards / screen readers
 *
 * The legacy /dashboard wraps its own AppHeader instead of this; both
 * share the ThemeToggle + Breadcrumbs primitives.
 */
import React from 'react';
import Link from 'next/link';
import { Flame, LayoutDashboard, Activity, Boxes, Ticket as TicketIcon, LifeBuoy, CalendarClock, Gauge, Stethoscope, GraduationCap, ClipboardCheck } from 'lucide-react';
import Breadcrumbs from './Breadcrumbs';
import ThemeToggle from './theme/ThemeToggle';

const NAV = [
  { href: '/overview',  label: '360° Overview', icon: Activity },
  { href: '/dashboard', label: 'Tests',          icon: LayoutDashboard },
  { href: '/psu',       label: 'Power Supply',   icon: Gauge },
  { href: '/diagnosis', label: 'Diagnosis',      icon: Stethoscope },
  { href: '/equipment', label: 'Equipment',      icon: Boxes },
  { href: '/inventory', label: 'Inventory',      icon: Boxes },
  { href: '/tickets',   label: 'Tickets',        icon: TicketIcon },
  { href: '/schedule',  label: 'Schedule',       icon: CalendarClock },
  { href: '/protocols', label: 'Protocols',      icon: ClipboardCheck },
  { href: '/trainings', label: 'Trainings',      icon: GraduationCap },
];
// RFQs removed from primary nav per operator feedback (2026-07): procurement
// RFQ flow is not an end-user surface. The /procurement/rfq route still
// exists for direct links; it is simply no longer promoted here.

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export default function AppShell({ children, title, subtitle, actions }: AppShellProps) {
  return (
    <div className="min-h-screen bg-app text-app flex flex-col" data-testid="app-shell">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="border-b border-app bg-surface">
        <div className="px-6 py-3 flex items-center justify-between gap-3">
          <Link href="/overview" className="flex items-center gap-2.5 group" data-testid="brand-link">
            <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-600 rounded-md flex items-center justify-center shadow-lg shadow-orange-500/20">
              <Flame className="w-4 h-4 text-white" aria-hidden />
            </div>
            <div className="leading-tight">
              <h1 className="text-sm font-bold text-app tracking-tight">Agnipariksha</h1>
              <p className="text-[9px] uppercase tracking-[0.18em] text-muted">
                Shreshtata · PV Reliability
              </p>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-1" aria-label="Primary">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium text-muted hover:text-app hover:bg-surface-2"
                data-testid={`nav-${href.replace(/[/]/g, '-').replace(/^-/, '')}`}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden />
                <span>{label}</span>
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/help/troubleshooting"
              className="hidden md:inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium text-muted hover:text-app hover:bg-surface-2"
              data-testid="nav-help"
            >
              <LifeBuoy className="w-3.5 h-3.5" aria-hidden /> Help
            </Link>
            <ThemeToggle />
            <span className="text-[10px] text-muted hidden lg:inline">
              Press <kbd className="px-1 rounded bg-surface-2 border border-app font-mono">?</kbd> for shortcuts
            </span>
          </div>
        </div>

        <div className="px-6 py-2 flex items-center justify-between gap-3 border-t border-app">
          <Breadcrumbs />
          <div className="flex items-center gap-2">{actions}</div>
        </div>

        {(title || subtitle) && (
          <div className="px-6 py-3">
            {title && <h2 className="text-xl font-semibold text-app">{title}</h2>}
            {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
          </div>
        )}
      </header>

      <main id="main" className="flex-1" data-testid="app-main">
        {children}
      </main>
    </div>
  );
}
