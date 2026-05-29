'use client';

/**
 * Operator + Customer + Equipment context, persisted in localStorage.
 *
 * The IEC report (Tab-5) needs Operator / Equipment ID / Company /
 * Customer / Method headers populated on every PDF. Pre-PR-D every
 * test session shipped these as "NA" because the data was never
 * captured. This store collects them once at the AppShell level so
 * every test session stamps them onto its `TestSession` record.
 *
 * Dependency-free external store via useSyncExternalStore — same
 * pattern as lib/nameplate-store.ts.
 */
import { useSyncExternalStore } from 'react';

export interface OperatorContext {
  /** Who's running the test. Free-text — falls back to "Anonymous". */
  operatorName: string;
  /** Operator's internal employee/badge ID. */
  operatorId: string;
  /** Lab / company running the qualification. */
  companyName: string;
  /** End customer the module is being qualified for (Reliance, etc.). */
  customerName: string;
  /** Station / equipment IDs being used. */
  equipmentId: string;
  /** Test method reference (typ. project SOW). */
  methodReference: string;
}

export const OPERATOR_DEFAULTS: OperatorContext = {
  operatorName: '',
  operatorId: '',
  companyName: '',
  customerName: '',
  equipmentId: 'ITECH PV6000 IT6005C-80-150 / ESPEC SH-242 / Keysight 34465A',
  methodReference: '',
};

const STORAGE_KEY = 'agnipariksha:operator-context:v1';

function read(): OperatorContext {
  if (typeof window === 'undefined') return OPERATOR_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return OPERATOR_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<OperatorContext>;
    return { ...OPERATOR_DEFAULTS, ...parsed };
  } catch {
    return OPERATOR_DEFAULTS;
  }
}

const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

let snapshot: OperatorContext = read();

/** Module-level setter so non-React callers (e.g. server-action shims) can update too. */
export function setOperatorContext(partial: Partial<OperatorContext>): void {
  const next = { ...snapshot, ...partial };
  snapshot = next;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  emit();
}

export function getOperatorContext(): OperatorContext {
  return snapshot;
}

/** React subscription hook. */
export function useOperatorContext(): OperatorContext {
  return useSyncExternalStore(subscribe, () => snapshot, () => OPERATOR_DEFAULTS);
}

/**
 * Apply the active operator context to a session payload at start-time.
 * Tabs call this in `onStart` so every PDF auto-gets the right header
 * fields without each tab forking the metadata logic.
 *
 * Generic on the input so callers can pass either a fully-built
 * `TestSession` or any object with the same metadata fields — the
 * returned shape matches the input.
 */
/**
 * Any record carrying optional operator-context fields. Permissive on the
 * caller side: tabs can pass their `TestSession` object directly; tests
 * can pass minimal shapes.
 */
export type TestSessionLike = Partial<OperatorContext>;

export function stampOperatorContext<T extends TestSessionLike>(session: T): T & OperatorContext {
  const ctx = getOperatorContext();
  const stamped: OperatorContext = {
    operatorName: session.operatorName || ctx.operatorName || 'Anonymous',
    operatorId: session.operatorId || ctx.operatorId || 'N/A',
    companyName: session.companyName || ctx.companyName || 'N/A',
    customerName: session.customerName || ctx.customerName || 'N/A',
    equipmentId: session.equipmentId || ctx.equipmentId || OPERATOR_DEFAULTS.equipmentId,
    methodReference: session.methodReference || ctx.methodReference || 'IEC 61215/61730 series',
  };
  return { ...session, ...stamped };
}
