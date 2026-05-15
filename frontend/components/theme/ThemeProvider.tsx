'use client';

/**
 * Theme provider — toggles the `.dark` class on <html>. Persists to
 * localStorage and honours `prefers-color-scheme` on first paint.
 *
 * Why a custom provider instead of next-themes: the project already
 * has a hard `dark` class on <html className="dark"> in layout.tsx,
 * we just need the runtime toggle + a small hook. Keeping it in-tree
 * avoids the extra dep + hydration mismatch we'd get from a heavier
 * library on the dashboard tree.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Theme = 'dark' | 'light';

interface ThemeCtx {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);
const STORAGE_KEY = 'agni-theme';

function applyClass(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.setAttribute('data-theme', theme);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Default to dark so the SSR markup matches the initial render. The
  // first useEffect below corrects it from storage / system pref.
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    let initial: Theme = 'dark';
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (stored === 'dark' || stored === 'light') {
        initial = stored;
      } else if (window.matchMedia?.('(prefers-color-scheme: light)').matches) {
        initial = 'light';
      }
    } catch {
      /* localStorage might be disabled — fall back to dark */
    }
    setThemeState(initial);
    applyClass(initial);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    applyClass(t);
    try {
      window.localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const value = useMemo<ThemeCtx>(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Safe fallback when used outside the provider — keeps unit tests
    // and isolated stories working without a wrapper.
    return {
      theme: 'dark',
      setTheme: () => {},
      toggle: () => {},
    };
  }
  return ctx;
}
