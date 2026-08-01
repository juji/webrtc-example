import { create } from "zustand";

export type MessageStatus = "sending" | "in-transit" | "sent" | "read";

export type ChatMessage = {
  messageId: string;
  text?: string;
  files: { name: string; type: string; url: string }[];
  fromSelf: boolean;
  status: MessageStatus;
  createdAt: string;
};

// Server row shape (server/src/db/schema.ts's `messages` table).
export type MessageRow = {
  id: string;
  clientId: string;
  text: string | null;
  fileName: string | null;
  fileType: string | null;
  fileUrl: string | null;
  recipientAckedAt: string | null;
  createdAt: string;
};

type MessagesState = {
  byPeer: Record<string, ChatMessage[]>;
  addMessage: (peer: string, message: ChatMessage) => void;
  updateStatus: (peer: string, messageId: string, status: MessageStatus) => void;
};

// Stable reference for peers with no messages yet, so selectors like
// `byPeer[peer] ?? EMPTY_MESSAGES` don't return a new array every render.
export const EMPTY_MESSAGES: ChatMessage[] = [];

export const useMessagesStore = create<MessagesState>()((set) => ({
  byPeer: {},

  addMessage: (peer, message) =>
    set((state) => ({
      byPeer: { ...state.byPeer, [peer]: [...(state.byPeer[peer] ?? []), message] },
    })),

  updateStatus: (peer, messageId, status) =>
    set((state) => ({
      byPeer: {
        ...state.byPeer,
        [peer]: (state.byPeer[peer] ?? []).map((m) => (m.messageId === messageId ? { ...m, status } : m)),
      },
    })),
}));
