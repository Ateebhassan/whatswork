// WhatsWork service worker: shows push notifications and opens the right day when tapped
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'WhatsWork', {
    body: d.body || '',
    tag: d.tag,
    renotify: !!d.tag,
    silent: !!d.silent,
    icon: 'icon-192.png',
    badge: 'badge-96.png',
    actions: Array.isArray(d.actions) ? d.actions.slice(0, 2) : [],
    data: { url: d.url || './', doneUrl: d.doneUrl || null },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const d = e.notification.data || {};
  const url = new URL((e.action === 'done' && d.doneUrl) || d.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope)) { await c.focus(); c.postMessage({ url }); return; }
    }
    await clients.openWindow(url);
  })());
});
