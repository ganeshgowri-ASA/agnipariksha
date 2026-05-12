/* Agnipariksha Web Push service worker.
 *
 * Receives JSON pushes from the backend (`/api/push/test` and event
 * triggers) and surfaces them as system notifications. Clicking a
 * notification focuses an existing tab or opens the bundled URL.
 */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Agnipariksha', body: 'Update from test station', url: '/' };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch (_e) {
      payload.body = event.data.text();
    }
  }
  const opts = {
    body: payload.body,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: { url: payload.url || '/' },
    tag: payload.tag || 'agnipariksha',
    renotify: !!payload.renotify,
  };
  event.waitUntil(self.registration.showNotification(payload.title, opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) {
          try { w.navigate(target); } catch (_e) { /* ignore */ }
          return w.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
