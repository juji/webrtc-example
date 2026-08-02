## Context

Redesigning the attach/upload flow (`ChatPane`'s attach menu: Upload file / Record audio / Record video / Take photo). Two threads so far: separating image uploads from other file types so images get a max-dimension cap, and figuring out what's possible for video.

## Decided

- **Single attach menu on both mobile and desktop** — not forking the menu by platform. Mobile's native `<input capture>` camera sheet would be less code, but hands the whole capture UX to the OS with no hook to resize before upload, which defeats the point of this redesign. Desktop has no native equivalent anyway, so it needs the custom popup regardless.
- **Image resize (upload + "Take photo") is cheap**: both go through a canvas already or can — clamp to a max dimension, draw, `toBlob`. No new dependency.
- **Video resize is not cheap**: `MediaRecorder` records at whatever resolution the source `MediaStream` provides. There is no browser-native "resample this video file" primitive. Two real levers:
  1. Constrain `getUserMedia`'s requested `video: { width, height }` *before* recording starts — cheap, but only controls capture-time resolution, not post-hoc resizing of an already-recorded or uploaded video file.
  2. Real transcoding via `ffmpeg.wasm` — the only way to actually resample an arbitrary video (recorded or uploaded) after the fact.
- **`ffmpeg.wasm` cost, if used**: the core `.wasm` binary is ~30MB (single-threaded build) — two to three orders of magnitude heavier than every other dependency in this app. Not bundled into the app's JS at build time regardless — `@ffmpeg/ffmpeg`'s `load()` fetches the core files at runtime, on demand.
- **Loading strategy: cache-on-first-use, not preload-on-install.** Preloading unconditionally in `sw.js`'s `install` handler would force every visitor to download 30MB even if they never touch video — rejected for that reason. Instead: `sw.js`'s `fetch` handler (currently a no-op passthrough, see `client/public/sw.js`) gets a cache-first strategy scoped to the ffmpeg core URLs — first video action pays the download, `caches.open()` stores it, every use after that (including across reloads/restarts) serves from that explicit cache instead of depending on the browser's own eviction-prone HTTP cache.

## Open / not yet decided

- Exact max dimension for images/photo capture.
- Whether video gets ffmpeg.wasm real resizing at all, or just the cheap `getUserMedia` capture-constraint (no resize for *uploaded* video files in that case — only what's recorded through this app's own capture popup).
- If ffmpeg.wasm is in: when `ffmpeg.load()` actually fires (lazy on first use vs. pre-warmed when the video/photo capture popup opens, to mask the wait behind camera-permission/preview time).
