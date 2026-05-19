/**
 * Per-module IV source mode selection (G17).
 *
 * Keyed by Module ID so the same dashboard can drive multiple DUTs that
 * each chose a different capture pipeline (4-Quadrant SMU vs. PSU +
 * Oscilloscope vs. Offline Import). The store is in-memory only — the
 * persist middleware is intentionally not wired up, because per-Module-ID
 * persistence within a session is what the operator needs, and avoiding
 * localStorage sidesteps SSR-hydration mismatches on the dashboard route.
 *
 * NOTE: This store only configures the capture pipeline. It never asserts
 * PSU output — the OUTP OFF invariant is enforced by the SCPI driver and
 * the test-tab control bar, not here.
 */
import { create } from 'zustand';

export type IvMode = 'iv4q' | 'ivPsuScope' | 'ivImport';

export const IV_MODES: readonly IvMode[] = ['iv4q', 'ivPsuScope', 'ivImport'] as const;

export const IV_MODE_LABELS: Record<IvMode, string> = {
  iv4q: '4-Quadrant SMU',
  ivPsuScope: 'PSU + Oscilloscope',
  ivImport: 'Offline Import',
};

export const IV_MODE_TEMPLATE_PATH: Record<IvMode, string> = {
  iv4q: '4q',
  ivPsuScope: 'psu-scope',
  ivImport: 'import',
};

export const DEFAULT_IV_MODE: IvMode = 'iv4q';

interface IvModeStore {
  modes: Record<string, IvMode>;
  setMode: (moduleId: string, mode: IvMode) => void;
}

export const useIvModeStore = create<IvModeStore>((set) => ({
  modes: {},
  setMode: (moduleId, mode) =>
    set((state) => ({ modes: { ...state.modes, [moduleId]: mode } })),
}));

export function readIvMode(modes: Record<string, IvMode>, moduleId: string): IvMode {
  return modes[moduleId] ?? DEFAULT_IV_MODE;
}
