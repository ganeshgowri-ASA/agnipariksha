'use client';

/**
 * Module ID context.
 *
 * The operator pins the panel/serial they're testing once, and every tab
 * (Setup -> Live Monitor -> Data -> Analysis -> Report) keys its AI thread
 * off the same identifier. Lives in localStorage so a refresh during a long
 * IEC test doesn't lose the binding.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react';

const STORAGE_KEY = 'agnipariksha.moduleId';

interface ModuleIdContextValue {
  moduleId: string;
  setModuleId: (id: string) => void;
  clearModuleId: () => void;
}

const Ctx = createContext<ModuleIdContextValue | null>(null);

export function ModuleIdProvider({ children }: { children: ReactNode }) {
  const [moduleId, setModuleIdState] = useState<string>('');

  // Hydrate from localStorage after mount so SSR markup stays stable.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) setModuleIdState(stored);
  }, []);

  const setModuleId = useCallback((id: string) => {
    const cleaned = id.trim().slice(0, 128);
    setModuleIdState(cleaned);
    if (typeof window !== 'undefined') {
      if (cleaned) window.localStorage.setItem(STORAGE_KEY, cleaned);
      else window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const clearModuleId = useCallback(() => setModuleId(''), [setModuleId]);

  const value = useMemo(
    () => ({ moduleId, setModuleId, clearModuleId }),
    [moduleId, setModuleId, clearModuleId],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useModuleId(): ModuleIdContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useModuleId must be used inside <ModuleIdProvider>');
  return v;
}
