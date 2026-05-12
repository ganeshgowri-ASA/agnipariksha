'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';

type Status = 'unsupported' | 'denied' | 'idle' | 'pending' | 'subscribed';

function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

/**
 * Bell-style toggle that the user clicks to opt into web push.
 *
 * Renders nothing on browsers without Push support — the rest of the
 * remote-monitoring stack still works over the /ws/events socket.
 */
export default function PushOptIn(): React.ReactElement | null {
  const [status, setStatus] = useState<Status>('idle');

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!('PushManager' in window) || !('Notification' in window)) {
      setStatus('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setStatus('denied');
      return;
    }
    const reg = await getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    setStatus(sub ? 'subscribed' : 'idle');
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const subscribe = useCallback(async () => {
    setStatus('pending');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setStatus(perm === 'denied' ? 'denied' : 'idle'); return; }

      const keyResp = await fetch('/api/push/vapid-public-key');
      const { key } = await keyResp.json();
      if (!key) { setStatus('idle'); return; }

      const reg = await getRegistration();
      if (!reg) { setStatus('unsupported'); return; }

      const existing = await reg.pushManager.getSubscription();
      const sub = existing || await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });

      const subJson = sub.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } };
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: subJson.keys,
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        }),
      });
      setStatus('subscribed');
    } catch {
      setStatus('idle');
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setStatus('pending');
    const reg = await getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {});
      await sub.unsubscribe();
    }
    setStatus('idle');
  }, []);

  if (status === 'unsupported') return null;

  const onClick = status === 'subscribed' ? unsubscribe : subscribe;
  const Icon = status === 'subscribed' ? Bell : BellOff;
  const label =
    status === 'pending' ? 'Working…'
    : status === 'denied' ? 'Push blocked'
    : status === 'subscribed' ? 'Push on'
    : 'Enable push';

  return (
    <button
      type="button"
      onClick={status === 'pending' || status === 'denied' ? undefined : onClick}
      disabled={status === 'pending' || status === 'denied'}
      title={status === 'denied' ? 'Push is blocked — adjust browser settings to re-enable.' : 'Web Push notifications'}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border ${
        status === 'subscribed'
          ? 'border-emerald-700/60 bg-emerald-900/30 text-emerald-200'
          : status === 'denied'
            ? 'border-red-700/60 bg-red-900/30 text-red-300 cursor-not-allowed'
            : 'border-gray-700/60 bg-gray-900/40 text-gray-300 hover:bg-gray-800'
      }`}
      aria-pressed={status === 'subscribed'}
      aria-label={label}
    >
      {status === 'pending' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Icon className="w-3 h-3" />}
      {label}
    </button>
  );
}
