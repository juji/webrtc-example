import { getOrCreateSettings } from "./settings";

// Sourced from Pixabay, all by the same uploader — attribution required:
// Sound Effect by Universfield (https://pixabay.com/users/universfield-28281460/)
// from Pixabay (https://pixabay.com/).
export const NOTIFICATION_SOUND_FILES = [
  "universfield-new-notification-012-363675.mp3",
  "universfield-new-notification-036-485897.mp3",
  "universfield-new-notification-040-493469.mp3",
  "universfield-new-notification-051-494246.mp3",
  "universfield-new-notification-056-494256.mp3",
  "universfield-new-notification-057-494255.mp3",
  "universfield-new-notification-062-494544.mp3",
  "universfield-new-notification-09-352705.mp3",
];

let audio: HTMLAudioElement | null = null;
let audioFile: string | null = null;

function getAudio(file: string): HTMLAudioElement {
  if (!audio || audioFile !== file) {
    audio = new Audio(`/notif/${file}`);
    audioFile = file;
  }
  return audio;
}

export function playSoundFile(file: string): void {
  const el = getAudio(file);
  el.currentTime = 0;
  // Autoplay can be blocked before the user has interacted with the page at
  // all (browser autoplay policy) — a rejected play() is expected in that
  // window, not an error worth surfacing.
  el.play().catch(() => {});
}

export async function playNotificationSound(userId: string): Promise<void> {
  const { notificationSound, notificationSoundFile } = await getOrCreateSettings(userId);
  if (notificationSound === "never") return;
  if (notificationSound === "unfocused" && document.visibilityState === "visible") return;

  playSoundFile(notificationSoundFile);
}
