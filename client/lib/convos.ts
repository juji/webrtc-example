import type { ConvoMessage } from "primssg-db";
import { useDbStore } from "./db-store";

export type { ConvoMessage } from "primssg-db";

export async function addMessage(message: ConvoMessage): Promise<void> {
  await useDbStore.getState().connect();
  await useDbStore.getState().db.addMessage(message);
}

export async function listMessages(ownerId: string, threadId: string): Promise<ConvoMessage[]> {
  await useDbStore.getState().connect();
  return useDbStore.getState().db.listMessages(ownerId, threadId);
}

export async function storeFileBlob(key: string, blob: Blob): Promise<void> {
  await useDbStore.getState().connect();
  await useDbStore.getState().db.storeFileBlob(key, blob);
}

export async function getFileBlob(key: string): Promise<Blob | undefined> {
  await useDbStore.getState().connect();
  return useDbStore.getState().db.getFileBlob(key);
}
