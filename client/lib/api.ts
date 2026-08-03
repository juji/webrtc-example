import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { generateKeys, loadKeys, storeKeys, toBase64 } from "./keys";
import type { MessageRow } from "./messages-store";
import { GET, POST } from "./request";

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

  const { user } = await POST<{ user: User }>("/auth/register", {
    username,
    mlDsaPublicKey: toBase64(bundle.dsaPublicKey),
    mlKemPublicKey: toBase64(bundle.kemPublicKey),
  }).catch((err) => {
    if (err instanceof Error && err.message === "username already registered") {
      throw new Error("this username exists but isn't registered on this device");
    }
    throw err;
  });

  await storeKeys(user.id, bundle);

  return user;
}

// Login needs the server-issued id to look up local keys (id-keyed), but the
// id isn't known until the server resolves the username — /auth/challenge
// already looks the user up, so it returns userId alongside the nonce.
export async function login(username: string): Promise<User> {
  const { nonce, userId } = await POST<{ nonce: string; userId: string }>("/auth/challenge", { username });

  const keys = await loadKeys(userId);
  if (!keys) throw new Error("no local key for this username on this device");

  const signature = ml_dsa65.sign(new TextEncoder().encode(nonce), keys.dsaSecretKey);

  const { user } = await POST<{ user: User }>("/auth/login", { username, signature: toBase64(signature) });
  return user;
}

export async function loginOrRegister(username: string): Promise<User> {
  try {
    await POST("/auth/challenge", { username });
  } catch {
    return register(username);
  }
  return login(username);
}

export async function logout(): Promise<void> {
  await POST("/auth/logout");
}

export type PublicUser = { id: string; username: string; mlKemPublicKey: string };

export async function fetchUserById(id: string): Promise<PublicUser | null> {
  try {
    const { user } = await GET<{ user: PublicUser }>(`/users/${id}`);
    return user;
  } catch {
    return null;
  }
}

export async function fetchVapidPublicKey(): Promise<string> {
  const { publicKey } = await GET<{ publicKey: string }>("/push/vapid-public-key");
  return publicKey;
}

export async function subscribeToPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
): Promise<void> {
  await POST("/push/subscribe", subscription);
}

export async function unsubscribeFromPush(endpoint: string): Promise<void> {
  await POST("/push/unsubscribe", { endpoint });
}

export async function sendTestPush(): Promise<void> {
  await POST("/push/test");
}

export async function sendContactRequest(toId: string, keyFingerprint: string): Promise<void> {
  await POST("/contacts/request", { toId, keyFingerprint });
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
  const { contact } = await POST<{ contact: AcceptedContact }>(`/contacts/requests/${requestId}/accept`);
  return contact;
}

export async function fetchContactRequests(): Promise<ContactRequestNotification[]> {
  const { notifications } = await GET<{ notifications: ContactRequestNotification[] }>("/notifications");
  return notifications;
}

export async function sendFailoverMessage(args: {
  clientId: string;
  toUsername: string;
  text: string;
}): Promise<MessageRow> {
  const { message } = await POST<{ message: MessageRow }>("/messages", args);
  return message;
}

export async function fetchFailoverMessages(peer: string): Promise<MessageRow[]> {
  const params = new URLSearchParams({ peer });
  const { messages } = await GET<{ messages: MessageRow[] }>(`/messages?${params}`);
  return messages;
}

export async function ackMessage(id: string): Promise<MessageRow> {
  const { message } = await POST<{ message: MessageRow }>(`/messages/${id}/ack`);
  return message;
}

export async function readMessage(id: string): Promise<MessageRow> {
  const { message } = await POST<{ message: MessageRow }>(`/messages/${id}/read`);
  return message;
}

export async function sendFailoverFile(args: {
  clientId: string;
  toUsername: string;
  file: File;
}): Promise<MessageRow> {
  const { clientId, toUsername, file } = args;

  const { putUrl, key } = await POST<{ putUrl: string; key: string }>("/messages/attachment/presign", {
    clientId,
    toUsername,
    fileName: file.name,
    fileType: file.type,
  });

  // Raw upload to the presigned S3 URL — not a call to our own server, so it
  // bypasses lib/request.ts (no credentials/base-URL/error-shape to apply).
  await fetch(putUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });

  const { message } = await POST<{ message: MessageRow }>("/messages/attachment/confirm", {
    clientId,
    toUsername,
    fileName: file.name,
    fileType: file.type,
    key,
  });
  return message;
}
