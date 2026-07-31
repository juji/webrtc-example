// Minimal service worker — required for PWA installability.
// Push/notification handling is added in a later phase (see plans/contacts).
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // No caching strategy yet — network passthrough.
});
