/*
 * Alert handling, loaded into the app's service worker (see vite.config.ts).
 *
 * The server sends alerts in the "declarative" form: JSON with a
 * "notification" object. An iPhone on iOS 18.4 or later shows those by
 * itself and never runs this. Older iPhones and other browsers hand the
 * message here, and this shows the same alert.
 *
 * An alert must always be shown: an iPhone takes away the permission from an
 * app that receives a message and shows nothing.
 */
self.addEventListener('push', (event) => {
  let alert = {};
  try {
    alert = (event.data && event.data.json().notification) || {};
  } catch {
    // Not JSON. Show the plain alert below.
  }
  event.waitUntil(
    self.registration.showNotification(alert.title || 'Wardrobe', {
      body: alert.body || 'Tap for your outfit.',
      tag: alert.tag,
      data: { navigate: alert.navigate },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const wanted = event.notification.data && event.notification.data.navigate;
  // Only ever open the app's own address.
  const target = typeof wanted === 'string' && wanted.startsWith(self.registration.scope) ? wanted : self.registration.scope;
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of open) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
});
