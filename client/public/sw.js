// Minimal service worker — required for PWA installability, extended here
// with Web Push handling (see plans/contacts, Phase 4).

// Told by service-worker-registration.tsx on every mount — build config
// (NEXT_PUBLIC_SERVER_URL), not session data, so it can't come from
// IndexedDB the way the logged-in username below does. sw.js is a static
// file, never processed by Next's bundler, so it has no other way to know it.
let serverUrl = null;
self.addEventListener("message", (event) => {
  if (event.data?.type === "config") {
    serverUrl = event.data.serverUrl;
  }
});

// Reads the username directly out of the same IndexedDB row
// client/lib/session-store.ts's zustand persist middleware writes to
// (idb-keyval's default "keyval-store" DB / "keyval" store) — session data
// lives here instead of localStorage specifically so the SW can read it
// without needing the page to forward it via postMessage.
function getLoggedInUsername() {
  return new Promise((resolve) => {
    const req = indexedDB.open("keyval-store");
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("keyval")) {
        db.close();
        resolve(null);
        return;
      }
      const getReq = db.transaction("keyval", "readonly").objectStore("keyval").get("webrtc-session");
      getReq.onerror = () => {
        db.close();
        resolve(null);
      };
      getReq.onsuccess = () => {
        db.close();
        try {
          resolve(JSON.parse(getReq.result)?.state?.user?.username ?? null);
        } catch {
          resolve(null);
        }
      };
    };
  });
}

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
// new endpoint, which only the SW can do here.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      // Cheap gate before bothering with a resubscribe attempt — the actual
      // auth on /push/subscribe is the session cookie below, not this.
      const username = await getLoggedInUsername();
      if (!username || !serverUrl) return;

      const keyRes = await fetch(`${serverUrl}/push/vapid-public-key`);
      const { publicKey } = await keyRes.json();

      const subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;

      // credentials: "include" sends the httpOnly session cookie — service
      // workers can do this the same as any other fetch, it doesn't need
      // the page's help. The server derives identity from that, not username.
      await fetch(`${serverUrl}/push/subscribe`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
