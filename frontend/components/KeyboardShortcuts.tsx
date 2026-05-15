'use client';

/**
 * Global keyboard shortcuts: navigation, theme toggle, command palette.
 * Press `?` (Shift-/) anywhere to surface the cheatsheet modal.
 *
 * `g`-prefixed chord nav (Vim-style):
 *   g o → /overview
 *   g d → /dashboard
 *   g e → /equipment
 *   g i → /inventory
 *   g t → /tickets
 *
 * Standalone:
 *   Shift+T → toggle theme
 *   ?       → open cheatsheet
 *   Esc     → close cheatsheet
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Keyboard, X } from 'lucide-react';
import { useTheme } from './theme/ThemeProvider';

const ROUTES: Record<string, string> = {
  o: '/overview',
  d: '/dashboard',
  e: '/equipment',
  i: '/inventory',
  t: '/tickets',
  s: '/schedule',
  h: '/help/troubleshooting',
};

const CHORD_TIMEOUT_MS = 1200;

function inEditableTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

export default function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { toggle } = useTheme();
  const pendingG = useRef(false);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearChord = useCallback(() => {
    pendingG.current = false;
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    pendingTimer.current = null;
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (inEditableTarget(e)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Cheatsheet
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setOpen((o) => !o);
        clearChord();
        return;
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
        return;
      }

      // Theme toggle (Shift+T)
      if (e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        toggle();
        clearChord();
        return;
      }

      // Chord: g + key
      if (!pendingG.current && e.key === 'g' && !e.shiftKey) {
        e.preventDefault();
        pendingG.current = true;
        pendingTimer.current = setTimeout(clearChord, CHORD_TIMEOUT_MS);
        return;
      }
      if (pendingG.current) {
        const target = ROUTES[e.key.toLowerCase()];
        if (target) {
          e.preventDefault();
          router.push(target);
        }
        clearChord();
      }
    }

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearChord();
    };
  }, [open, router, toggle, clearChord]);

  const rows = useMemo(
    () => [
      { keys: ['?'], label: 'Open this cheatsheet' },
      { keys: ['Esc'], label: 'Close modal / panel' },
      { keys: ['Shift', 'T'], label: 'Toggle dark / light theme' },
      { keys: ['g', 'o'], label: 'Go to 360° Overview' },
      { keys: ['g', 'd'], label: 'Go to Tests dashboard' },
      { keys: ['g', 'e'], label: 'Go to Equipment health' },
      { keys: ['g', 'i'], label: 'Go to Inventory / spares' },
      { keys: ['g', 't'], label: 'Go to Tickets' },
      { keys: ['g', 's'], label: 'Go to Schedule' },
      { keys: ['g', 'h'], label: 'Go to Help / Troubleshooting' },
    ],
    [],
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kbd-shortcut-title"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4"
      onClick={() => setOpen(false)}
      data-testid="kbd-modal"
    >
      <div
        className="bg-surface border border-app rounded-lg shadow-2xl w-full max-w-md p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 id="kbd-shortcut-title" className="text-sm font-bold text-app inline-flex items-center gap-2">
            <Keyboard className="w-4 h-4" aria-hidden /> Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close shortcuts"
            className="p-1 rounded hover:bg-surface-2 text-muted hover:text-app"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center justify-between text-xs">
              <span className="text-app">{row.label}</span>
              <span className="flex gap-1">
                {row.keys.map((k) => (
                  <kbd
                    key={k}
                    className="px-1.5 py-0.5 rounded bg-surface-2 border border-app text-app font-mono text-[10px]"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[10px] text-muted mt-3">
          Tip: press <kbd className="px-1 rounded bg-surface-2 border border-app font-mono">g</kbd> then a destination letter (Vim-style).
        </p>
      </div>
    </div>
  );
}
