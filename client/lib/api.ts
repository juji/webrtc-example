import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { generateKeys, loadKeys, storeKeys, toBase64 } from "./keys";
import type { MessageRow } from "./messages-store";

export const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";
export const SIGNALING_URL = SERVER_URL.replace(/^http/, "ws");

export type User = {
  id: string;
  username: string;
  createdAt: string;
};

// Registration needs the server-issued id before keys can be stored under it
// (client/lib/keys.ts is id-keyed) — but the register call itself needs the
// public keys. Generate first (no DB write), send the public halves, then
// store the full bundle under the id the server just assigned.
export async function register(username: string): Promise<User> {
  const bundle = generateKeys();

  const res = await fetch(`${SERVER_URL}/auth/register`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      mlDsaPublicKey: toBase64(bundle.dsaPublicKey),
      mlKemPublicKey: toBase64(bundle.kemPublicKey),
    }),
  });
  if (res.status === 409) {
    throw new Error("this username exists but isn't registered on this device");
  }
  if (!res.ok) throw new Error((await res.json()).error ?? "registration failed");
  const { user } = await res.json();

  await storeKeys(user.id, bundle);

  return user;
}

// Login needs the server-issued id to look up local keys (id-keyed), but the
// id isn't known until the server resolves the username — /auth/challenge
// already looks the user up, so it returns userId alongside the nonce.
export async function login(username: string): Promise<User> {
  const challengeRes = await fetch(`${SERVER_URL}/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!challengeRes.ok) throw new Error((await challengeRes.json()).error ?? "challenge failed");
  const { nonce, userId } = await challengeRes.json();

  const keys = await loadKeys(userId);
  if (!keys) throw new Error("no local key for this username on this device");

  const signature = ml_dsa65.sign(new TextEncoder().encode(nonce), keys.dsaSecretKey);

  const loginRes = await fetch(`${SERVER_URL}/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, signature: toBase64(signature) }),
  });
  if (!loginRes.ok) throw new Error((await loginRes.json()).error ?? "login failed");
  const { user } = await loginRes.json();
  return user;
}

export async function loginOrRegister(username: string): Promise<User> {
  const challengeRes = await fetch(`${SERVER_URL}/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (challengeRes.status === 404) return register(username);
  if (!challengeRes.ok) throw new Error((await challengeRes.json()).error ?? "challenge failed");
  return login(username);
}

export async function logout(): Promise<void> {
  await fetch(`${SERVER_URL}/auth/logout`, { method: "POST", credentials: "include" });
}

export type PublicUser = { id: string; username: string; mlKemPublicKey: string };

export async function fetchUserById(id: string): Promise<PublicUser | null> {
  const res = await fetch(`${SERVER_URL}/users/${id}`);
  if (!res.ok) return null;
  const { user } = await res.json();
  return user;
}

export async function fetchVapidPublicKey(): Promise<string> {
  const res = await fetch(`${SERVER_URL}/push/vapid-public-key`);
  const { publicKey } = await res.json();
  return publicKey;
}

export async function subscribeToPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
): Promise<void> {
  await fetch(`${SERVER_URL}/push/subscribe`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription),
  });
}

export async function unsubscribeFromPush(endpoint: string): Promise<void> {
  await fetch(`${SERVER_URL}/push/unsubscribe`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
}

export async function sendTestPush(): Promise<void> {
  const res = await fetch(`${SERVER_URL}/push/test`, { method: "POST", credentials: "include" });
  if (!res.ok) throw new Error((await res.json()).error ?? "test push failed");
}

export async function sendContactRequest(toId: string, keyFingerprint: string): Promise<void> {
  const res = await fetch(`${SERVER_URL}/contacts/request`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toId, keyFingerprint }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "failed to send contact request");
}

export type ContactRequestNotification = {
  id: string;
  type: "contact_request";
  status: "pending" | "accepted";
  createdAt: string;
  data: {
    direction: "incoming" | "outgoing";
    otherUserId: string;
    otherUsername: string;
    pairId: string;
    scannedFingerprint: string;
  };
};

export type AcceptedContact = { id: string; username: string; mlKemPublicKey: string };

export async function acceptContactRequest(requestId: string): Promise<AcceptedContact> {
  const res = await fetch(`${SERVER_URL}/contacts/requests/${requestId}/accept`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "failed to accept contact request");
  const { contact } = await res.json();
  return contact;
}

export async function fetchContactRequests(): Promise<ContactRequestNotification[]> {
  const res = await fetch(`${SERVER_URL}/notifications`, { credentials: "include" });
  const { notifications } = await res.json();
  return notifications;
}

export async function sendFailoverMessage(args: {
  clientId: string;
  toUsername: string;
  text: string;
}): Promise<MessageRow> {
  const res = await fetch(`${SERVER_URL}/messages`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const { message } = await res.json();
  return message;
}

export async function fetchFailoverMessages(peer: string): Promise<MessageRow[]> {
  const params = new URLSearchParams({ peer });
  const res = await fetch(`${SERVER_URL}/messages?${params}`, { credentials: "include" });
  const { messages } = await res.json();
  return messages;
}

export async function ackMessage(id: string): Promise<MessageRow> {
  const res = await fetch(`${SERVER_URL}/messages/${id}/ack`, { method: "POST", credentials: "include" });
  const { message } = await res.json();
  return message;
}

export async function readMessage(id: string): Promise<MessageRow> {
  const res = await fetch(`${SERVER_URL}/messages/${id}/read`, { method: "POST", credentials: "include" });
  const { message } = await res.json();
  return message;
}

export async function deleteMessage(id: string): Promise<void> {
  await fetch(`${SERVER_URL}/messages/${id}`, { method: "DELETE", credentials: "include" });
}

export async function sendFailoverFile(args: {
  clientId: string;
  toUsername: string;
  file: File;
}): Promise<MessageRow> {
  const { clientId, toUsername, file } = args;

  const presignRes = await fetch(`${SERVER_URL}/messages/attachment/presign`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, toUsername, fileName: file.name, fileType: file.type }),
  });
  const { putUrl, key } = await presignRes.json();

  await fetch(putUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });

  const confirmRes = await fetch(`${SERVER_URL}/messages/attachment/confirm`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, toUsername, fileName: file.name, fileType: file.type, key }),
  });
  const { message } = await confirmRes.json();
  return message;
}
