import type { NotificationSoundMode, Settings } from "primssg-db";
import { useDbStore } from "./db-store";

export type { NotificationSoundMode, Settings } from "primssg-db";

export async function getOrCreateSettings(id: string): Promise<Settings> {
  await useDbStore.getState().connect();
  return useDbStore.getState().db.getOrCreateSettings(id);
}

export async function updateSettings(id: string, settings: Settings): Promise<void> {
  await useDbStore.getState().connect();
  await useDbStore.getState().db.updateSettings(id, settings);
}
