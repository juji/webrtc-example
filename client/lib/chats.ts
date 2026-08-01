import type { Conversation, LastMessage } from "primssg-db";
import { useDbStore } from "./db-store";

export type { Conversation, LastMessage } from "primssg-db";

export async function listConversations(ownerId: string): Promise<Conversation[]> {
  await useDbStore.getState().connect();
  return useDbStore.getState().db.listConversations(ownerId);
}

export async function getOrCreateConversation(ownerId: string, contactId: string): Promise<Conversation> {
  await useDbStore.getState().connect();
  return useDbStore.getState().db.getOrCreateConversation(ownerId, contactId);
}

export async function setLastMessage(ownerId: string, contactId: string, lastMessage: LastMessage): Promise<void> {
  await useDbStore.getState().connect();
  await useDbStore.getState().db.setLastMessage(ownerId, contactId, lastMessage);
}
