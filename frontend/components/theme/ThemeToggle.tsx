'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider';

export default function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
      aria-pressed={!isDark}
      title={`Switch to ${isDark ? 'light' : 'dark'} theme (Shift+T)`}
      data-testid="theme-toggle"
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] font-medium transition-colors border-gray-700/60 bg-gray-900/40 text-gray-300 hover:text-white hover:bg-gray-800 ${className ?? ''}`}
    >
      {isDark ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
      <span className="hidden md:inline">{isDark ? 'Dark' : 'Light'}</span>
    </button>
  );
}
