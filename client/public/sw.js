// Minimal service worker — required for PWA installability, extended here
// with Web Push handling (see plans/contacts, Phase 4).

// Told by service-worker-registration.tsx on every mount — the SW has no
// access to localStorage/session state on its own, but pushsubscriptionchange
// below needs to know who to re-register a rotated subscription for.
let auth = null;
self.addEventListener("message", (event) => {
  if (event.data?.type === "auth") {
    auth = { username: event.data.username, serverUrl: event.data.serverUrl };
  }
});

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
        badge: "/icon-192.png",
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

// Fires when the browser/push service invalidates the current subscription
// (rotation, expiry) — the old endpoint is gone for good at that point, no
// server-side fix can revive it (see server/src/push.ts's 404/410 cleanup).
// The only recovery is subscribing again and telling the server about the
// new endpoint, which only the SW can do here — nothing calls this if no
// page has posted "auth" yet (e.g. the SW was never told who's logged in).
self.addEventListener("pushsubscriptionchange", (event) => {
  if (!auth) return;
  event.waitUntil(
    (async () => {
      const keyRes = await fetch(`${auth.serverUrl}/push/vapid-public-key`);
      const { publicKey } = await keyRes.json();

      const subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;

      await fetch(`${auth.serverUrl}/push/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: auth.username,
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
        }),
      });
    })(),
  );
});

// Mirrors client/lib/push.ts's urlBase64ToUint8Array — sw.js is a static
// file, not part of the Next bundle, so it can't import the shared helper.
function urlBase64ToUint8Array(base64Url) {
  const base64 = (base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

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
