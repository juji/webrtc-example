import { create } from "zustand";
import { SIGNALING_URL } from "./api";
import type { MessageRow } from "./messages-store";

export type SignalMessage =
  | { type: "offer"; sdp: RTCSessionDescriptionInit; to: string; from?: string }
  | { type: "answer"; sdp: RTCSessionDescriptionInit; to: string; from?: string }
  | { type: "ice-candidate"; candidate: RTCIceCandidateInit; to: string; from?: string };

// Delivery-status pushes (Phase 2's notifyUser), distinct from WebRTC signaling above
// but carried over the same one WebSocket — see message-status-listener.tsx.
export type MessageStatusPush =
  | { type: "new-message"; message: MessageRow; fromUsername: string }
  | { type: "message-acked"; id: number; clientId: string; peerUsername: string };

type SignalingListener = (message: SignalMessage | MessageStatusPush) => void;

type SignalingState = {
  ws: WebSocket | null;
  connected: boolean;
  connect: (username: string) => void;
  disconnect: () => void;
  send: (message: SignalMessage & { to: string }) => void;
  subscribe: (listener: SignalingListener) => () => void;
};

const listeners = new Set<SignalingListener>();
// Messages sent before the socket finishes opening (WebSocket.send() throws otherwise).
const sendQueue: string[] = [];
// A chat page's useWebRtcChat effect subscribes asynchronously (after an ICE-servers
// fetch resolves), so an offer/candidate can arrive before any listener exists yet.
// Buffer the last few incoming messages and replay them to a listener the instant it
// subscribes, so a message that arrived "too early" isn't silently dropped.
const recentMessages: (SignalMessage | MessageStatusPush)[] = [];
const RECENT_MESSAGES_LIMIT = 20;

export const useSignalingStore = create<SignalingState>()((set, get) => ({
  ws: null,
  connected: false,

  connect: (username) => {
    if (get().ws) return;

    const ws = new WebSocket(`${SIGNALING_URL}/signaling?username=${encodeURIComponent(username)}`);

    ws.onopen = () => {
      set({ connected: true });
      for (const payload of sendQueue.splice(0)) ws.send(payload);
    };

    ws.onmessage = (event) => {
      const message: SignalMessage | MessageStatusPush = JSON.parse(event.data);
      recentMessages.push(message);
      if (recentMessages.length > RECENT_MESSAGES_LIMIT) recentMessages.shift();
      for (const listener of listeners) listener(message);
    };

    ws.onclose = () => {
      set({ ws: null, connected: false });
    };

    set({ ws });
  },

  disconnect: () => {
    get().ws?.close();
    set({ ws: null, connected: false });
  },

  send: (message) => {
    const payload = JSON.stringify(message);
    const ws = get().ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    } else {
      sendQueue.push(payload);
    }
  },

  subscribe: (listener) => {
    listeners.add(listener);
    for (const message of recentMessages) listener(message);
    return () => listeners.delete(listener);
  },
}));
