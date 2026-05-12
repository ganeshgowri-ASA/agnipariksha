'use client';

import { Sparkles } from 'lucide-react';
import { askAI } from '@/hooks/useAskAIBus';

interface Props {
  prompt: string;
  runId?: string | null;
  tab?: string;
  label?: string;
  send?: boolean;
  className?: string;
}

export default function AskAIButton({ prompt, runId, tab, label = 'Ask AI', send = false, className }: Props) {
  return (
    <button
      type="button"
      data-testid="ask-ai"
      data-prompt={prompt}
      onClick={() => askAI({ prompt, run_id: runId, tab, send })}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium bg-orange-900/30 hover:bg-orange-800/40 border border-orange-700/50 text-orange-200 transition-colors ${className ?? ''}`}
    >
      <Sparkles className="w-3 h-3" />
      {label}
    </button>
  );
}
