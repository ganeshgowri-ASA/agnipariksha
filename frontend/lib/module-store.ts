/**
 * Shared module-under-test store. Captures the operator's currently selected
 * PV module ID (scanned via camera or pasted in the Setup tab) so every test
 * tab — TC, HF, LeTID, BDT, RCO, GCT, DH — and the ReportGenerator all see
 * the same value without prop drilling.
 *
 * Validation state mirrors the /api/modules/{id} lookup so the Setup panel
 * can show the resolved nameplate (model, manufacturer, Isc/Voc/Pmax) and
 * downstream tabs can pre-fill electrical parameters when desired.
 */
import { create } from 'zustand';

export interface ModuleNameplate {
  id: string;
  model?: string;
  manufacturer?: string;
  pmax_w?: number;
  voc_v?: number;
  isc_a?: number;
  vmpp_v?: number;
  impp_a?: number;
}

export type ModuleSource = 'manual' | 'paste' | 'scan';

export type ValidationStatus = 'idle' | 'validating' | 'valid' | 'invalid' | 'error';

interface ModuleStoreState {
  moduleId: string;
  source: ModuleSource;
  validation: ValidationStatus;
  validationMessage: string;
  nameplate: ModuleNameplate | null;
  scanHistory: string[];

  setModuleId: (id: string, source?: ModuleSource) => void;
  clear: () => void;
  validate: (id?: string) => Promise<void>;
}

const HISTORY_LIMIT = 10;

function pushHistory(prev: string[], id: string): string[] {
  const trimmed = id.trim();
  if (!trimmed) return prev;
  const without = prev.filter((x) => x !== trimmed);
  return [trimmed, ...without].slice(0, HISTORY_LIMIT);
}

export const useModuleStore = create<ModuleStoreState>((set, get) => ({
  moduleId: '',
  source: 'manual',
  validation: 'idle',
  validationMessage: '',
  nameplate: null,
  scanHistory: [],

  setModuleId: (id, source = 'manual') => {
    const trimmed = id.trim();
    set((s) => ({
      moduleId: trimmed,
      source,
      validation: trimmed === '' ? 'idle' : s.validation,
      validationMessage: trimmed === '' ? '' : s.validationMessage,
      nameplate: trimmed === '' ? null : s.nameplate,
      scanHistory: source === 'scan' ? pushHistory(s.scanHistory, trimmed) : s.scanHistory,
    }));
  },

  clear: () =>
    set({
      moduleId: '',
      source: 'manual',
      validation: 'idle',
      validationMessage: '',
      nameplate: null,
    }),

  validate: async (id) => {
    const target = (id ?? get().moduleId).trim();
    if (!target) {
      set({ validation: 'idle', validationMessage: '', nameplate: null });
      return;
    }
    set({ validation: 'validating', validationMessage: 'Looking up module…' });
    try {
      const res = await fetch(`/api/modules/${encodeURIComponent(target)}`, {
        cache: 'no-store',
      });
      if (res.status === 404) {
        set({
          validation: 'invalid',
          validationMessage: `Module "${target}" not found in catalogue`,
          nameplate: null,
        });
        return;
      }
      if (!res.ok) {
        set({
          validation: 'error',
          validationMessage: `Lookup failed (HTTP ${res.status})`,
          nameplate: null,
        });
        return;
      }
      const body = (await res.json()) as ModuleNameplate;
      set({
        validation: 'valid',
        validationMessage: body.model
          ? `${body.manufacturer ?? ''} ${body.model}`.trim()
          : 'Module recognised',
        nameplate: body,
      });
    } catch (e) {
      set({
        validation: 'error',
        validationMessage: e instanceof Error ? e.message : 'Network error',
        nameplate: null,
      });
    }
  },
}));
