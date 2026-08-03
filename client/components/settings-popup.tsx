"use client";

import { useEffect, useState } from "react";
import type { User } from "@/lib/api";
import { NOTIFICATION_SOUND_FILES, playSoundFile } from "@/lib/notification-sound";
import { updateSettings, type NotificationSoundMode } from "@/lib/settings";
import { getSettingsFromIndexedDb, mirrorSettingsToIndexedDb } from "@/lib/settings-mirror";
import { Popup } from "./popup";

const OPTIONS: { value: NotificationSoundMode; label: string; description: string }[] = [
  { value: "always", label: "Always", description: "Play a sound for every incoming notification." },
  { value: "unfocused", label: "When not focused", description: "Only play a sound while this tab isn't active." },
  { value: "never", label: "Never", description: "Never play a sound." },
];

const TABS = [{ id: "notification", label: "Notification" }] as const;

export function SettingsPopup({ open, onClose, user }: { open: boolean; onClose: () => void; user: User }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("notification");
  const [mode, setMode] = useState<NotificationSoundMode>("unfocused");
  const [soundFile, setSoundFile] = useState(NOTIFICATION_SOUND_FILES[0]);

  useEffect(() => {
    if (!open) return;
    getSettingsFromIndexedDb(user.id).then((settings) => {
      setMode(settings.notificationSound);
      setSoundFile(settings.notificationSoundFile);
    });
  }, [open, user]);

  async function handleSelect(value: NotificationSoundMode) {
    setMode(value);
    const settings = { notificationSound: value, notificationSoundFile: soundFile };
    await updateSettings(user.id, settings);
    await mirrorSettingsToIndexedDb(user.id, settings);
  }

  async function handleSelectSound(file: string) {
    setSoundFile(file);
    playSoundFile(file);
    const settings = { notificationSound: mode, notificationSoundFile: file };
    await updateSettings(user.id, settings);
    await mirrorSettingsToIndexedDb(user.id, settings);
  }

  return (
    <Popup open={open} onClose={onClose} title="Settings" buttons={[]}>
      <div className="-mt-2 mb-4 flex gap-1 border-b border-black/10 dark:border-white/10">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-b-2 border-orange-500 text-foreground"
                : "border-b-2 border-transparent text-zinc-500"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-4">
        <div>
          <ul className="flex flex-col gap-2">
            {OPTIONS.map((option) => (
              <li key={option.value}>
                <button
                  onClick={() => handleSelect(option.value)}
                  className={`flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                    mode === option.value
                      ? "border-orange-500 bg-orange-500/10"
                      : "border-black/10 dark:border-white/10"
                  }`}
                >
                  <span
                    className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${
                      mode === option.value ? "border-orange-500 bg-orange-500" : "border-black/20 dark:border-white/20"
                    }`}
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{option.label}</span>
                    <span className="text-sm text-zinc-500">{option.description}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-medium">Sound</h3>
          <ul className="grid grid-cols-4 gap-2">
            {NOTIFICATION_SOUND_FILES.map((file, i) => (
              <li key={file}>
                <button
                  onClick={() => handleSelectSound(file)}
                  className={`w-full rounded-lg border px-2 py-2 text-center text-sm transition-colors ${
                    soundFile === file ? "border-orange-500 bg-orange-500/10" : "border-black/10 dark:border-white/10"
                  }`}
                >
                  {i + 1}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
            Sound Effect by{" "}
            <a
              href="https://pixabay.com/users/universfield-28281460/?utm_source=link-attribution&utm_medium=referral&utm_campaign=music&utm_content=494246"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Universfield
            </a>{" "}
            from{" "}
            <a
              href="https://pixabay.com//?utm_source=link-attribution&utm_medium=referral&utm_campaign=music&utm_content=494246"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Pixabay
            </a>
          </p>
        </div>
      </div>
    </Popup>
  );
}
