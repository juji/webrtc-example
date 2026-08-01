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
  createdAt: string;
};
