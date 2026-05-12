/**
 * Shared utilities for barcode / QR scanning.
 *
 * Two input paths are supported:
 *   1. Camera scan via html5-qrcode (rendered on /scan).
 *   2. USB HID scanners — most behave as keyboards: they "type" the payload
 *      then send a terminator (Enter). The {@link useHidScanner} hook
 *      listens at the window level, accumulates printable keys with a
 *      gap-based reset (≤30ms between keys ≈ scanner, not human typing),
 *      and fires the callback on Enter.
 */
import { useEffect, useRef } from 'react';

export type ScannedKind = 'module' | 'equipment' | 'sparepart' | 'session' | 'unknown';

export interface ParsedScan {
  raw: string;
  kind: ScannedKind;
  id: string;
  /** Path the dashboard should navigate to after a successful scan. */
  href: string;
}

const PREFIX_TO_KIND: Record<string, ScannedKind> = {
  MOD: 'module',
  EQP: 'equipment',
  SPR: 'sparepart',
  SES: 'session',
};

const KIND_TO_ROUTE: Record<ScannedKind, (id: string) => string> = {
  module:    (id) => `/modules/${encodeURIComponent(id)}`,
  equipment: (id) => `/equipment/${encodeURIComponent(id)}`,
  sparepart: (id) => `/spare-parts/${encodeURIComponent(id)}`,
  session:   (id) => `/?tab=results&session=${encodeURIComponent(id)}`,
  unknown:   (id) => `/?scan=${encodeURIComponent(id)}`,
};

/**
 * Parse a scanned payload. Recognises ``KIND-<id>`` (e.g. ``MOD-001234``)
 * as well as bare IDs (treated as ``unknown`` so the dashboard can still
 * surface them).
 */
export function parseScan(raw: string): ParsedScan {
  const trimmed = (raw ?? '').trim();
  const m = /^([A-Z]{2,4})-(.+)$/.exec(trimmed);
  if (m) {
    const kind = PREFIX_TO_KIND[m[1] as keyof typeof PREFIX_TO_KIND] ?? 'unknown';
    const id = m[2];
    return { raw: trimmed, kind, id, href: KIND_TO_ROUTE[kind](id) };
  }
  return { raw: trimmed, kind: 'unknown', id: trimmed, href: KIND_TO_ROUTE.unknown(trimmed) };
}

/**
 * Window-level HID keyboard scanner listener.
 *
 * The hook accumulates printable characters and fires ``onScan`` when the
 * buffer is terminated by Enter and the inter-key gap stayed under
 * ``maxIntervalMs``. Typing into an input element (text / textarea /
 * contentEditable) is ignored so human typing never triggers a scan.
 */
export function useHidScanner(
  onScan: (parsed: ParsedScan) => void,
  opts: { maxIntervalMs?: number; minLength?: number; enabled?: boolean } = {},
): void {
  const { maxIntervalMs = 30, minLength = 4, enabled = true } = opts;
  const bufRef = useRef('');
  const lastRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    function isEditable(el: EventTarget | null): boolean {
      const node = el as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      return !!node.isContentEditable;
    }

    function handler(e: KeyboardEvent): void {
      if (isEditable(e.target)) return;
      const now = performance.now();
      const gap = now - lastRef.current;
      if (gap > maxIntervalMs) {
        bufRef.current = '';
      }
      lastRef.current = now;

      if (e.key === 'Enter') {
        const payload = bufRef.current;
        bufRef.current = '';
        if (payload.length >= minLength) {
          onScan(parseScan(payload));
        }
        return;
      }
      if (e.key.length === 1) {
        bufRef.current += e.key;
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, maxIntervalMs, minLength, onScan]);
}
