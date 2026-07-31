import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { generateAndStoreKeys, loadKeys, toBase64 } from "./keys";
import type { MessageRow } from "./messages-store";

export const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";
export const SIGNALING_URL = SERVER_URL.replace(/^http/, "ws");

export type User = {
  id: string;
  username: string;
  createdAt: string;
};

export async function register(username: string): Promise<User> {
  const { dsaPublicKey, kemPublicKey } = await generateAndStoreKeys(username);
  const res = await fetch(`${SERVER_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      mlDsaPublicKey: toBase64(dsaPublicKey),
      mlKemPublicKey: toBase64(kemPublicKey),
    }),
  });
  if (res.status === 409) {
    throw new Error("this username exists but isn't registered on this device");
  }
  if (!res.ok) throw new Error((await res.json()).error ?? "registration failed");
  const { user } = await res.json();
  return user;
}

export async function login(username: string): Promise<User> {
  const keys = await loadKeys(username);
  if (!keys) throw new Error("no local key for this username on this device");

  const challengeRes = await fetch(`${SERVER_URL}/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!challengeRes.ok) throw new Error((await challengeRes.json()).error ?? "challenge failed");
  const { nonce } = await challengeRes.json();

  const signature = ml_dsa65.sign(new TextEncoder().encode(nonce), keys.dsaSecretKey);

  const loginRes = await fetch(`${SERVER_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, signature: toBase64(signature) }),
  });
  if (!loginRes.ok) throw new Error((await loginRes.json()).error ?? "login failed");
  const { user } = await loginRes.json();
  return user;
}

export async function loginOrRegister(username: string): Promise<User> {
  const existingKeys = await loadKeys(username);
  return existingKeys ? login(username) : register(username);
}

export type PublicUser = { id: string; username: string; mlKemPublicKey: string };

export async function fetchUserById(id: string): Promise<PublicUser | null> {
  const res = await fetch(`${SERVER_URL}/users/${id}`);
  if (!res.ok) return null;
  const { user } = await res.json();
  return user;
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

export async function ackMessage(id: string): Promise<MessageRow> {
  const res = await fetch(`${SERVER_URL}/messages/${id}/ack`, { method: "POST" });
  const { message } = await res.json();
  return message;
}

export async function deleteMessage(id: string): Promise<void> {
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
