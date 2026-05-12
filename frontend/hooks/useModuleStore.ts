/**
 * Global selected-Module + active-run store. Backed by zustand (already
 * a project dependency).
 *
 * Switching the module starts a new AI thread; switching tabs reuses
 * the same thread but updates its tab_context. The component layer
 * owns the AIAssistant lifecycle — the store just exposes the values
 * everyone needs.
 */
import { create } from 'zustand';
import type { PVModule } from '@/types/module';

interface ModuleStore {
  modules: PVModule[];
  selectedId: string | null;
  activeRunId: string | null;
  ready: boolean;

  setModules: (list: PVModule[]) => void;
  upsertModule: (m: PVModule) => void;
  removeModule: (id: string) => void;
  select: (id: string | null) => void;
  setActiveRun: (run_id: string | null) => void;
  markReady: () => void;
}

export const useModuleStore = create<ModuleStore>((set) => ({
  modules: [],
  selectedId: null,
  activeRunId: null,
  ready: false,
  setModules: (list) => set((s) => ({
    modules: list,
    selectedId: s.selectedId && list.some((m) => m.module_id === s.selectedId)
      ? s.selectedId
      : list[0]?.module_id ?? null,
  })),
  upsertModule: (m) => set((s) => {
    const idx = s.modules.findIndex((x) => x.module_id === m.module_id);
    const next = idx >= 0
      ? [...s.modules.slice(0, idx), m, ...s.modules.slice(idx + 1)]
      : [m, ...s.modules];
    return { modules: next, selectedId: m.module_id };
  }),
  removeModule: (id) => set((s) => {
    const next = s.modules.filter((m) => m.module_id !== id);
    return {
      modules: next,
      selectedId: s.selectedId === id ? next[0]?.module_id ?? null : s.selectedId,
    };
  }),
  select: (id) => set({ selectedId: id, activeRunId: null }),
  setActiveRun: (run_id) => set({ activeRunId: run_id }),
  markReady: () => set({ ready: true }),
}));

export function useSelectedModule(): PVModule | null {
  return useModuleStore((s) => {
    if (!s.selectedId) return null;
    return s.modules.find((m) => m.module_id === s.selectedId) ?? null;
  });
}
