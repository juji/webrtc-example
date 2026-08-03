export type KeyBundle = {
  dsaPublicKey: Uint8Array;
  dsaSecretKey: Uint8Array;
  kemPublicKey: Uint8Array;
  kemSecretKey: Uint8Array;
};

export type Contact = {
  ownerId: string; // which locally-registered identity this contact belongs to
  id: string; // the contact's user id
  username: string;
  mlKemPublicKey: string; // base64, pinned at accept time — never re-fetched
  acceptedAt: string;
};

export type LastMessage = { sender: string; message: string; status: string };

export type Conversation = {
  ownerId: string; // which locally-registered identity this conversation belongs to
  contactId: string; // the other party's user id
  lastMessage: LastMessage | null;
  unreadCount: number;
  createdAt: string;
};

export type ConvoMessage = {
  ownerId: string; // which locally-registered identity this row belongs to
  threadId: string; // a contact's user id (1:1) or a group id (group chat)
  messageId: string; // ties this row back to the live message (use-webrtc-chat.ts)
  serverId?: string; // server row id, only set for server-fallback-delivered messages
  sender: { id: string; username: string }; // id === ownerId if fromSelf
  text?: string;
  file?: { name: string; type: string; url: string };
  status: "sending" | "in-transit" | "sent" | "read";
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
};

export type NotificationSoundMode = "always" | "unfocused" | "never";

// One row per user id (not ownerId — this table has exactly one row per
// account, not many, so the user id is the primary key directly). settings
// is stored as JSON text in SQLite, parsed to this shape on read — extending
// this later is adding a field here + a default, not a schema migration.
export type Settings = {
  notificationSound: NotificationSoundMode;
  notificationSoundFile: string; // filename under client/public/, e.g. "universfield-new-notification-012-363675.mp3"
};
