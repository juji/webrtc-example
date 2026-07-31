// Minimal service worker — required for PWA installability, extended here
// with Web Push handling (see plans/contacts, Phase 4).
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // No caching strategy yet — network passthrough.
});

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : { title: "Primssg", body: "" };
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title, {
        body: data.body,
        icon: "/icon-192.png",
        data: { url: data.url ?? "/", payload: data.data },
      }),
      // Broadcast the structured payload to any already-open tab right away —
      // e.g. a contact-accepted push needs the receiving client to re-verify
      // and persist the contact, not just wait for a notification click.
      data.data
        ? self.clients
            .matchAll({ type: "window", includeUncontrolled: true })
            .then((clients) => clients.forEach((c) => c.postMessage({ type: "push-data", data: data.data })))
        : Promise.resolve(),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  const payload = event.notification.data?.payload;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => new URL(c.url).origin === self.location.origin);
      if (existing) {
        // postMessage instead of client.navigate(): navigate() forces a full
        // document reload, bypassing Next's client-side router entirely.
        // The already-running app listens for this and does a real client-side
        // transition instead (see client/app/service-worker-registration.tsx).
        existing.postMessage({ type: "notification-click", url, data: payload });
        return existing.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
