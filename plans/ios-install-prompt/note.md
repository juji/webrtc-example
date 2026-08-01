# iOS needs an "install this app" prompt for push to work — not yet built

Surfaced while researching Safari/WebKit support for the future IndexedDB-backup idea (`plans/dexie-migration`), but this gap already exists today, for the push notifications feature that's already shipped (`plans/contacts` Phase 4).

## The gap

On iOS/iPadOS Safari, a service worker only runs `push`/`notificationclick` handling for a PWA that's actually been installed to the home screen (Share → Add to Home Screen). A user just visiting the site in a regular Safari tab gets no push notifications at all — not degraded, not delayed, just silently nothing. There's currently no UI anywhere in this app that tells an iOS user this, or prompts them to install.

Desktop Safari and other browsers (Chrome, Firefox, Android) don't have this limitation — service workers/push work in a regular tab. This is iOS-specific.

## What would need deciding, before building anything

- How to detect "this is iOS Safari, not installed as a PWA" client-side (a mix of UA sniffing and `navigator.standalone`/`display-mode: standalone` media query checks — no single clean API for this).
- What the prompt actually says/looks like, and when it shows (once, dismissible, persistent banner, etc.).
- Whether this is worth building at all given the app's current scope/audience, or just a known limitation to accept.

Not scoped further than this — a note, not a plan, until someone picks it up.
