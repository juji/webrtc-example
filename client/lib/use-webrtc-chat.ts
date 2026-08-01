import { useEffect, useRef, useState } from "react";
import { uuidv7 } from "uuidv7";
import { ackMessage, fetchFailoverMessages, sendFailoverFile, sendFailoverMessage, SERVER_URL } from "./api";
import { addMessage as persistMessage, listMessages } from "./convos";
import { EMPTY_MESSAGES, useMessagesStore, type ChatMessage, type MessageStatus } from "./messages-store";
import { useSignalingStore, type SignalMessage } from "./signaling-store";

// Every text frame on the data channel is one of these. Binary frames are always
// raw file chunks belonging to the most recently started transfer.
type DataChannelMessage =
  | { kind: "text"; messageId: string; text: string }
  | { kind: "file-start"; messageId: string; name: string; type: string }
  | { kind: "file-end"; messageId: string }
  | { kind: "ack"; messageId: string }
  | { kind: "read"; messageId: string };

export type { ChatMessage };

// RTCDataChannel messages are unreliable above a few hundred KB across browsers,
// so files are sliced into small binary chunks and reassembled on the other end.
const CHUNK_SIZE = 16 * 1024;

// `dc.readyState === "open"` doesn't guarantee the recipient is actually still
// receiving (stale-but-open channel). If no P2P ack arrives in time, fall back
// to the server so the message doesn't strand at "in-transit" forever.
const ACK_TIMEOUT_MS = 4000;

async function fetchIceServers(): Promise<RTCIceServer[]> {
  const res = await fetch(`${SERVER_URL}/turn/credentials`);
  const { iceServers } = await res.json();
  return iceServers;
}

// Deterministic: whoever sorts first initiates the offer, so no "call" button is needed.
function isInitiator(self: string, peer: string) {
  return self < peer;
}

export function useWebRtcChat(selfId: string, selfUsername: string, peerId: string, peerUsername: string) {
  const [connected, setConnected] = useState(false);
  const messages = useMessagesStore((s) => s.byPeer[peerUsername] ?? EMPTY_MESSAGES);
  const addMessage = useMessagesStore((s) => s.addMessage);
  const updateStatus = useMessagesStore((s) => s.updateStatus);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const incomingFileRef = useRef<{ id: string; name: string; type: string; chunks: ArrayBuffer[] } | null>(
    null,
  );
  // messageId -> pending ack-timeout, so a real ack can cancel it before it fires.
  const ackTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Mirrors every in-memory addMessage/updateStatus into webrtc-convos so a
  // reload doesn't lose history — messages-store.ts stays the live/render
  // source of truth, this is a write-through, not a replacement for it.
  function persist(message: ChatMessage) {
    persistMessage({
      ownerId: selfId,
      threadId: peerId,
      messageId: message.messageId,
      sender: message.fromSelf ? { id: selfId, username: selfUsername } : { id: peerId, username: peerUsername },
      text: message.text,
      files: message.files,
      status: message.status,
      createdAt: message.createdAt,
      sentAt: message.status === "sent" || message.status === "read" ? new Date().toISOString() : null,
      deliveredAt: message.status === "read" ? new Date().toISOString() : null,
    });
  }

  function addAndPersist(message: ChatMessage) {
    addMessage(peerUsername, message);
    persist(message);
  }

  function updateStatusAndPersist(messageId: string, status: MessageStatus) {
    updateStatus(peerUsername, messageId, status);
    const updated = useMessagesStore.getState().byPeer[peerUsername]?.find((m) => m.messageId === messageId);
    if (updated) persist(updated);
  }

  // Server-dispatch fallback: used when the channel isn't open, and when a P2P
  // send's ack-timeout fires. Shared by both sendMessage and sendFile. The row
  // id isn't tracked client-side — message-acked carries it directly, so the
  // sender's final DELETE works even after closing and reopening the app.
  function dispatchTextViaServer(messageId: string, text: string) {
    sendFailoverMessage({ clientId: messageId, fromUsername: selfUsername, toUsername: peerUsername, text });
  }

  function dispatchFileViaServer(messageId: string, file: File) {
    sendFailoverFile({ clientId: messageId, fromUsername: selfUsername, toUsername: peerUsername, file });
  }

  function armAckTimeout(messageId: string, onTimeout: () => void) {
    const timer = setTimeout(() => {
      ackTimersRef.current.delete(messageId);
      onTimeout();
    }, ACK_TIMEOUT_MS);
    ackTimersRef.current.set(messageId, timer);
  }

  // Load persisted history on mount — messages-store.ts is in-memory only and
  // starts empty on every reload/remount; webrtc-convos is what survives that.
  // Only seeds messages this peer thread doesn't already have in memory (a
  // fast remount within the same session shouldn't duplicate what's already there).
  useEffect(() => {
    listMessages(selfId, peerId).then((rows) => {
      const existingIds = new Set(useMessagesStore.getState().byPeer[peerUsername]?.map((m) => m.messageId));
      for (const row of rows) {
        if (existingIds.has(row.messageId)) continue;
        addMessage(peerUsername, {
          messageId: row.messageId,
          text: row.text,
          files: row.files,
          fromSelf: row.sender.id === selfId,
          status: row.status,
          createdAt: row.createdAt,
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfId, peerId, peerUsername]);

  // One-shot catch-up fetch on mount: anything the peer sent while this device
  // was unreachable. Not a poll — runs once per chat-page visit.
  useEffect(() => {
    fetchFailoverMessages(peerUsername, selfUsername).then((rows) => {
      for (const row of rows) {
        addAndPersist({
          messageId: row.clientId,
          text: row.text ?? undefined,
          files: row.fileUrl ? [{ name: row.fileName!, type: row.fileType!, url: row.fileUrl }] : [],
          fromSelf: false,
          status: "sent",
          createdAt: row.createdAt,
        });
        ackMessage(row.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerUsername, selfUsername]);

  // Viewing a thread marks the peer's delivered messages read — local status flip,
  // best-effort echo over the data channel if still connected, no server involvement.
  useEffect(() => {
    const state = useMessagesStore.getState();
    for (const m of state.byPeer[peerUsername] ?? EMPTY_MESSAGES) {
      if (m.fromSelf || m.status !== "sent") continue;
      updateStatusAndPersist(m.messageId, "read");
      dcRef.current?.send(JSON.stringify({ kind: "read", messageId: m.messageId } satisfies DataChannelMessage));
    }
  });

  useEffect(() => {
    // React StrictMode (dev) mounts, cleans up, and mounts again in the same tick. Opening the
    // RTCPeerConnection only after the ICE servers fetch resolves lets the aborted first run's
    // cleanup flip `cancelled` before any real connection is made.
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    fetchIceServers().then((iceServers) => {
      if (cancelled) return;

      const iceTransportPolicy = (process.env.NEXT_PUBLIC_ICE_TRANSPORT_POLICY ?? "all") as RTCIceTransportPolicy;
      const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy });
      pcRef.current = pc;

      function send(message: SignalMessage) {
        useSignalingStore.getState().send({ ...message, to: peerUsername });
      }

      function setupDataChannel(dc: RTCDataChannel) {
        dc.binaryType = "arraybuffer";
        dcRef.current = dc;
        dc.onopen = () => setConnected(true);
        dc.onclose = () => setConnected(false);
        dc.onmessage = (event) => {
          if (event.data instanceof ArrayBuffer) {
            incomingFileRef.current?.chunks.push(event.data);
            return;
          }

          const message: DataChannelMessage = JSON.parse(event.data);

          if (message.kind === "text") {
            addAndPersist({
              messageId: message.messageId,
              text: message.text,
              files: [],
              fromSelf: false,
              status: "sent",
              createdAt: new Date().toISOString(),
            });
            dc.send(JSON.stringify({ kind: "ack", messageId: message.messageId } satisfies DataChannelMessage));
          } else if (message.kind === "file-start") {
            incomingFileRef.current = { id: message.messageId, name: message.name, type: message.type, chunks: [] };
          } else if (message.kind === "file-end") {
            const transfer = incomingFileRef.current;
            incomingFileRef.current = null;
            if (!transfer || transfer.id !== message.messageId) return;
            const blob = new Blob(transfer.chunks, { type: transfer.type });
            const url = URL.createObjectURL(blob);
            addAndPersist({
              messageId: message.messageId,
              files: [{ name: transfer.name, type: transfer.type, url }],
              fromSelf: false,
              status: "sent",
              createdAt: new Date().toISOString(),
            });
            dc.send(JSON.stringify({ kind: "ack", messageId: message.messageId } satisfies DataChannelMessage));
          } else if (message.kind === "ack") {
            const timer = ackTimersRef.current.get(message.messageId);
            if (timer) {
              clearTimeout(timer);
              ackTimersRef.current.delete(message.messageId);
            }
            updateStatusAndPersist(message.messageId, "sent");
          } else if (message.kind === "read") {
            updateStatusAndPersist(message.messageId, "read");
          }
        };
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          send({ type: "ice-candidate", candidate: event.candidate.toJSON(), to: peerUsername });
        }
      };

      if (isInitiator(selfUsername, peerUsername)) {
        setupDataChannel(pc.createDataChannel("chat"));
      } else {
        pc.ondatachannel = (event) => setupDataChannel(event.channel);
      }

      unsubscribe = useSignalingStore.getState().subscribe(async (message) => {
        if (message.type !== "offer" && message.type !== "answer" && message.type !== "ice-candidate") return;
        if (message.from !== peerUsername) return;

        if (message.type === "offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send({ type: "answer", sdp: answer, to: peerUsername });
        } else if (message.type === "answer") {
          await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
        } else if (message.type === "ice-candidate") {
          await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
        }
      });

      if (isInitiator(selfUsername, peerUsername)) {
        pc.createOffer().then(async (offer) => {
          await pc.setLocalDescription(offer);
          send({ type: "offer", sdp: offer, to: peerUsername });
        });
      }
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
      pcRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfId, selfUsername, peerId, peerUsername]);

  function sendMessage(text: string) {
    const messageId = uuidv7();
    addAndPersist({
      messageId,
      text,
      files: [],
      fromSelf: true,
      status: "sending",
      createdAt: new Date().toISOString(),
    });

    const dc = dcRef.current;
    if (dc && dc.readyState === "open") {
      updateStatusAndPersist(messageId, "in-transit");
      dc.send(JSON.stringify({ kind: "text", messageId, text } satisfies DataChannelMessage));
      armAckTimeout(messageId, () => dispatchTextViaServer(messageId, text));
    } else {
      updateStatusAndPersist(messageId, "in-transit");
      dispatchTextViaServer(messageId, text);
    }
  }

  async function sendFile(file: File) {
    const messageId = uuidv7();
    const url = URL.createObjectURL(file);
    addAndPersist({
      messageId,
      files: [{ name: file.name, type: file.type, url }],
      fromSelf: true,
      status: "sending",
      createdAt: new Date().toISOString(),
    });

    const dc = dcRef.current;
    if (dc && dc.readyState === "open") {
      updateStatusAndPersist(messageId, "in-transit");
      dc.send(JSON.stringify({ kind: "file-start", messageId, name: file.name, type: file.type } satisfies DataChannelMessage));

      const buffer = await file.arrayBuffer();
      for (let offset = 0; offset < buffer.byteLength; offset += CHUNK_SIZE) {
        dc.send(buffer.slice(offset, offset + CHUNK_SIZE));
      }

      dc.send(JSON.stringify({ kind: "file-end", messageId } satisfies DataChannelMessage));
      armAckTimeout(messageId, () => dispatchFileViaServer(messageId, file));
    } else {
      updateStatusAndPersist(messageId, "in-transit");
      dispatchFileViaServer(messageId, file);
    }
  }

  return { connected, messages, sendMessage, sendFile };
}
