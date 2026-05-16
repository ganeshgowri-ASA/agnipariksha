'use client';

/**
 * Boots the MSW browser worker when MSW is enabled for this build.
 *
 * Activation rules:
 *   - production:  never (the dynamic import + guard are tree-shaken)
 *   - dev:         on by default, opt out with NEXT_PUBLIC_MSW=0
 *   - Playwright:  webServer sets NEXT_PUBLIC_MSW=1
 *
 * Children render immediately; the worker installs in the background. The
 * mock handlers only own /api/procurement/*, so the rest of the app is
 * unaffected while the worker is starting.
 */
import { useEffect } from 'react';

const ENABLED =
  process.env.NODE_ENV !== 'production' &&
  process.env.NEXT_PUBLIC_MSW !== '0';

export default function MswProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!ENABLED) return;
    if (typeof window === 'undefined') return;
    let cancelled = false;
    void (async () => {
      const { worker } = await import('@/mocks/browser');
      if (cancelled) return;
      await worker.start({
        onUnhandledRequest: 'bypass',
        serviceWorker: { url: '/mockServiceWorker.js' },
        quiet: true,
      });
      // Signal for Playwright: wait for window.__MSW_READY before fetching.
      (window as unknown as { __MSW_READY?: boolean }).__MSW_READY = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return <>{children}</>;
}
