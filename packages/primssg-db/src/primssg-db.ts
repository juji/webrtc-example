import type { Contact, Conversation, ConvoMessage, KeyBundle, LastMessage } from "./types";

export abstract class PrimssgDB {
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;

  // keys
  abstract storeKeys(id: string, bundle: KeyBundle): Promise<void>;
  abstract loadKeys(id: string): Promise<KeyBundle | undefined>;

  // contacts
  abstract addContact(contact: Contact): Promise<void>;
  abstract listContacts(ownerId: string): Promise<Contact[]>;
  abstract getContact(ownerId: string, id: string): Promise<Contact | undefined>;

  // chats
  abstract listConversations(ownerId: string): Promise<Conversation[]>;
  abstract getOrCreateConversation(ownerId: string, contactId: string): Promise<Conversation>;
  abstract setLastMessage(ownerId: string, contactId: string, lastMessage: LastMessage): Promise<void>;
  abstract incrementUnread(ownerId: string, contactId: string): Promise<void>;
  abstract clearUnread(ownerId: string, contactId: string): Promise<void>;

  // convos
  abstract addMessage(message: ConvoMessage): Promise<void>;
  abstract listMessages(ownerId: string, threadId: string): Promise<ConvoMessage[]>;

  // file blobs — P2P-transferred files only exist as an in-memory blob: URL,
  // which dies on browser restart. Storing the raw bytes in OPFS lets the
  // caller mint a fresh blob: URL on the next session instead of a dead one.
  abstract storeFileBlob(key: string, blob: Blob): Promise<void>;
  abstract getFileBlob(key: string): Promise<Blob | undefined>;
}
