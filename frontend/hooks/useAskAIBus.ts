/**
 * One-shot event bus so inline "Ask AI" buttons can prefill the side
 * panel's input. Implemented as a window-level CustomEvent so it
 * crosses any future Suspense / portal boundaries with no plumbing.
 */
import { useEffect } from 'react';

export interface AskAIPrefill {
  prompt: string;
  run_id?: string | null;
  tab?: string;
  send?: boolean;
}

const EVT = 'agni:ask-ai';

export function askAI(payload: AskAIPrefill): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AskAIPrefill>(EVT, { detail: payload }));
}

export function useAskAIPrefill(handler: (p: AskAIPrefill) => void): void {
  useEffect(() => {
    const onEvt = (e: Event) => {
      const detail = (e as CustomEvent<AskAIPrefill>).detail;
      if (detail) handler(detail);
    };
    window.addEventListener(EVT, onEvt);
    return () => window.removeEventListener(EVT, onEvt);
  }, [handler]);
}
