'use client';

/**
 * Shared module nameplate, persisted per Module ID in localStorage.
 *
 * A single nameplate captures the as-built module parameters (Isc, Voc,
 * system voltage, bypass-diode + fuse data). Downstream test recipes read
 * it via `useNameplate` / `recipeDefaultsFromNameplate` so the operator
 * keys the data once instead of re-typing Isc on every tab.
 *
 * Dependency-free external store (useSyncExternalStore) — mirrors the
 * localStorage approach already used by lib/report-sections.ts.
 */
import { useSyncExternalStore } from 'react';

export interface Nameplate {
  manufacturer: string;
  model: string;
  /** Module serial number. */
  msn: string;
  mcind: string;
  /** Short-circuit current, A. */
  isc: number;
  /** Open-circuit voltage, V. */
  voc: number;
  /** Max system voltage, V. */
  systemVoltage: number;
  bypassDiodes: number;
  diodePartNumber: string;
  /** Bypass-diode max junction temperature, °C. */
  diodeTjMax: number;
  /** Series fuse current rating, A. */
  fuseCurrent: number;
  /** Set true once the module has been used in a test session. */
  used: boolean;
}

export const NAMEPLATE_DEFAULTS: Nameplate = {
  manufacturer: '',
  model: '',
  msn: '',
  mcind: '',
  isc: 0,
  voc: 0,
  systemVoltage: 1500,
  bypassDiodes: 3,
  diodePartNumber: '',
  diodeTjMax: 175,
  fuseCurrent: 20,
  used: false,
};

interface NameplateState {
  currentModuleId: string;
  byModule: Record<string, Nameplate>;
}

const STORAGE_KEY = 'agni-nameplates';

function normaliseId(id: string): string {
  const t = id.trim();
  return t.length > 0 ? t : '__default__';
}

function load(): NameplateState {
  const empty: NameplateState = { currentModuleId: '', byModule: {} };
  if (typeof window === 'undefined') return empty;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<NameplateState>;
    return {
      currentModuleId: typeof parsed.currentModuleId === 'string' ? parsed.currentModuleId : '',
      byModule: parsed.byModule && typeof parsed.byModule === 'object' ? parsed.byModule : {},
    };
  } catch {
    return empty;
  }
}

let state: NameplateState = load();
const listeners = new Set<() => void>();

function commit(next: NameplateState): void {
  state = next;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota / private mode — keep in-memory copy */
    }
  }
  listeners.forEach((l) => l());
}

export function setCurrentModuleId(id: string): void {
  commit({ ...state, currentModuleId: id });
}

export function getCurrentModuleId(): string {
  return state.currentModuleId;
}

export function saveNameplate(moduleId: string, np: Nameplate): void {
  const key = normaliseId(moduleId);
  commit({ ...state, byModule: { ...state.byModule, [key]: np } });
}

export function markNameplateUsed(moduleId: string): void {
  const key = normaliseId(moduleId);
  const existing = state.byModule[key];
  if (!existing || existing.used) return;
  commit({ ...state, byModule: { ...state.byModule, [key]: { ...existing, used: true } } });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useNameplateState(): NameplateState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/** The nameplate for the given (or current) Module ID, or null if none saved. */
export function useNameplate(moduleId?: string): Nameplate | null {
  const s = useNameplateState();
  const key = normaliseId(moduleId ?? s.currentModuleId);
  return s.byModule[key] ?? null;
}

/**
 * Recipe defaults derived from a nameplate, consumed by test tabs:
 *  - BDT MQT 18.1 currents_a → [Isc, 0.1·Isc]
 *  - BDT 62979 Isc           → Isc
 *  - PID stress voltage      → system voltage
 */
export function recipeDefaultsFromNameplate(np: Nameplate | null) {
  if (!np) return null;
  return {
    bdtMqt181CurrentsA: [np.isc, 0.1 * np.isc] as [number, number],
    bdt62979Isc: np.isc,
    pidStressVoltage: np.systemVoltage,
  };
}
