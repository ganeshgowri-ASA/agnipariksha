'use client';

import { useEffect, useState } from 'react';
import { Hash } from 'lucide-react';
import { useModuleId } from './ModuleIdContext';

/**
 * Header-level Module ID input. Persists to localStorage via ModuleIdContext
 * so the AI thread, telemetry context, and report metadata all stay in sync
 * across reloads and across the 7 IEC test tabs.
 */
export default function ModuleIdInput() {
  const { moduleId, setModuleId } = useModuleId();
  const [draft, setDraft] = useState(moduleId);

  useEffect(() => setDraft(moduleId), [moduleId]);

  const commit = () => {
    if (draft.trim() !== moduleId) setModuleId(draft.trim());
  };

  return (
    <label
      className="hidden md:inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border border-gray-700/60 bg-gray-900/40 text-gray-300"
      title="Active Module ID — keys the AI thread and tags reports"
    >
      <Hash className="w-3 h-3 opacity-70" />
      <span className="uppercase tracking-[0.12em] text-[10px] text-gray-500">Module</span>
      <input
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => e.key === 'Enter' && commit()}
        placeholder="MOD-…"
        className="w-28 bg-transparent border-0 focus:outline-none focus:ring-0 font-mono text-[11px] text-white placeholder-gray-600"
        aria-label="Module ID"
      />
    </label>
  );
}
