import { get, set } from "idb-keyval";
import type { Settings } from "primssg-db";

const DEFAULT_SETTINGS: Settings = { notificationSound: "unfocused", notificationSoundFile: "universfield-new-notification-012-363675.mp3" };

function key(userId: string): string {
  return `webrtc-settings-${userId}`;
}

// sw.js reads this same row directly via a raw indexedDB.open("keyval-store")
// call (it can't import idb-keyval — static file, not part of the Next
// bundle) — see plans/notification-sound Phase 2. Keyed by user id: this app
// supports multiple locally-registered identities in one browser, so the
// mirror must be per-account like every other local-storage table.
export async function getSettingsFromIndexedDb(userId: string): Promise<Settings> {
  const value = await get(key(userId));
  return value ?? DEFAULT_SETTINGS;
}

export async function mirrorSettingsToIndexedDb(userId: string, settings: Settings): Promise<void> {
  await set(key(userId), settings);
}

function focusKey(userId: string): string {
  return `webrtc-focus-${userId}`;
}

// Lets sw.js's push handler tell "unfocused" apart from "no tab open" —
// document.visibilityState/focus/blur only exist on the page, not the SW, so
// the page has to write its live focus state somewhere the SW can read it.
// See plans/notification-sound Phase 2.
export async function mirrorFocusToIndexedDb(userId: string, focused: boolean): Promise<void> {
  await set(focusKey(userId), focused);
}
