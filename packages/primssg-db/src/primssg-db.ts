import type { Contact, Conversation, KeyBundle } from "./types";

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
}
