import type { MessageRow } from "./messages-store";

export const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";
export const SIGNALING_URL = SERVER_URL.replace(/^http/, "ws");

export type User = {
  id: number;
  username: string;
  createdAt: string;
};

export async function loginOrRegister(username: string): Promise<User> {
  const res = await fetch(`${SERVER_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "login failed");
  const { user } = await res.json();
  return user;
}

export async function searchUsers(query: string, exclude: string): Promise<User[]> {
  const params = new URLSearchParams({ q: query, exclude });
  const res = await fetch(`${SERVER_URL}/users?${params}`);
  const { users } = await res.json();
  return users;
}

export async function sendFailoverMessage(args: {
  clientId: string;
  fromUsername: string;
  toUsername: string;
  text: string;
}): Promise<MessageRow> {
  const res = await fetch(`${SERVER_URL}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const { message } = await res.json();
  return message;
}

export async function fetchFailoverMessages(peer: string, self: string): Promise<MessageRow[]> {
  const params = new URLSearchParams({ peer, self });
  const res = await fetch(`${SERVER_URL}/messages?${params}`);
  const { messages } = await res.json();
  return messages;
}

export async function ackMessage(id: number): Promise<MessageRow> {
  const res = await fetch(`${SERVER_URL}/messages/${id}/ack`, { method: "POST" });
  const { message } = await res.json();
  return message;
}

export async function deleteMessage(id: number): Promise<void> {
  await fetch(`${SERVER_URL}/messages/${id}`, { method: "DELETE" });
}

export async function sendFailoverFile(args: {
  clientId: string;
  fromUsername: string;
  toUsername: string;
  file: File;
}): Promise<MessageRow> {
  const { clientId, fromUsername, toUsername, file } = args;

  const presignRes = await fetch(`${SERVER_URL}/messages/attachment/presign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, fromUsername, toUsername, fileName: file.name, fileType: file.type }),
  });
  const { putUrl, key } = await presignRes.json();

  await fetch(putUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });

  const confirmRes = await fetch(`${SERVER_URL}/messages/attachment/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, fromUsername, toUsername, fileName: file.name, fileType: file.type, key }),
  });
  const { message } = await confirmRes.json();
  return message;
}
