import { create } from "zustand";

export type MessageStatus = "sending" | "in-transit" | "sent" | "read";

export type ChatMessage = {
  clientId: string;
  text?: string;
  file?: { name: string; type: string; url: string };
  fromSelf: boolean;
  status: MessageStatus;
};

// Server row shape (server/src/db/schema.ts's `messages` table).
export type MessageRow = {
  id: number;
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
  updateStatus: (peer: string, clientId: string, status: MessageStatus) => void;
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

  updateStatus: (peer, clientId, status) =>
    set((state) => ({
      byPeer: {
        ...state.byPeer,
        [peer]: (state.byPeer[peer] ?? []).map((m) => (m.clientId === clientId ? { ...m, status } : m)),
      },
    })),
}));
