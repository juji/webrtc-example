import { useEffect, useRef, useState } from "react";
import { ackMessage, fetchFailoverMessages, sendFailoverFile, sendFailoverMessage, SERVER_URL } from "./api";
import { EMPTY_MESSAGES, setPendingSentRow, useMessagesStore, type ChatMessage } from "./messages-store";
import { useSignalingStore, type SignalMessage } from "./signaling-store";

// Every text frame on the data channel is one of these. Binary frames are always
// raw file chunks belonging to the most recently started transfer.
type DataChannelMessage =
  | { kind: "text"; clientId: string; text: string }
  | { kind: "file-start"; clientId: string; name: string; type: string }
  | { kind: "file-end"; clientId: string }
  | { kind: "ack"; clientId: string }
  | { kind: "read"; clientId: string };

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

export function useWebRtcChat(selfUsername: string, peerUsername: string) {
  const [connected, setConnected] = useState(false);
  const messages = useMessagesStore((s) => s.byPeer[peerUsername] ?? EMPTY_MESSAGES);
  const addMessage = useMessagesStore((s) => s.addMessage);
  const updateStatus = useMessagesStore((s) => s.updateStatus);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const incomingFileRef = useRef<{ id: string; name: string; type: string; chunks: ArrayBuffer[] } | null>(
    null,
  );
  // clientId -> pending ack-timeout, so a real ack can cancel it before it fires.
  const ackTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Server-dispatch fallback: used when the channel isn't open, and when a P2P
  // send's ack-timeout fires. Shared by both sendMessage and sendFile.
  function dispatchTextViaServer(clientId: string, text: string) {
    sendFailoverMessage({ clientId, fromUsername: selfUsername, toUsername: peerUsername, text }).then((row) => {
      setPendingSentRow(clientId, row.id);
    });
  }

  function dispatchFileViaServer(clientId: string, file: File) {
    sendFailoverFile({ clientId, fromUsername: selfUsername, toUsername: peerUsername, file }).then((row) => {
      setPendingSentRow(clientId, row.id);
    });
  }

  function armAckTimeout(clientId: string, onTimeout: () => void) {
    const timer = setTimeout(() => {
      ackTimersRef.current.delete(clientId);
      onTimeout();
    }, ACK_TIMEOUT_MS);
    ackTimersRef.current.set(clientId, timer);
  }

  // One-shot catch-up fetch on mount: anything the peer sent while this device
  // was unreachable. Not a poll — runs once per chat-page visit.
  useEffect(() => {
    fetchFailoverMessages(peerUsername, selfUsername).then((rows) => {
      for (const row of rows) {
        addMessage(peerUsername, {
          clientId: row.clientId,
          text: row.text ?? undefined,
          file: row.fileUrl ? { name: row.fileName!, type: row.fileType!, url: row.fileUrl } : undefined,
          fromSelf: false,
          status: "sent",
        });
        ackMessage(row.id);
      }
    });
  }, [peerUsername, selfUsername, addMessage]);

  // Viewing a thread marks the peer's delivered messages read — local status flip,
  // best-effort echo over the data channel if still connected, no server involvement.
  useEffect(() => {
    const state = useMessagesStore.getState();
    for (const m of state.byPeer[peerUsername] ?? EMPTY_MESSAGES) {
      if (m.fromSelf || m.status !== "sent") continue;
      state.updateStatus(peerUsername, m.clientId, "read");
      dcRef.current?.send(JSON.stringify({ kind: "read", clientId: m.clientId } satisfies DataChannelMessage));
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

      const pc = new RTCPeerConnection({ iceServers });
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
            addMessage(peerUsername, {
              clientId: message.clientId,
              text: message.text,
              fromSelf: false,
              status: "sent",
            });
            dc.send(JSON.stringify({ kind: "ack", clientId: message.clientId } satisfies DataChannelMessage));
          } else if (message.kind === "file-start") {
            incomingFileRef.current = { id: message.clientId, name: message.name, type: message.type, chunks: [] };
          } else if (message.kind === "file-end") {
            const transfer = incomingFileRef.current;
            incomingFileRef.current = null;
            if (!transfer || transfer.id !== message.clientId) return;
            const blob = new Blob(transfer.chunks, { type: transfer.type });
            const url = URL.createObjectURL(blob);
            addMessage(peerUsername, {
              clientId: message.clientId,
              file: { name: transfer.name, type: transfer.type, url },
              fromSelf: false,
              status: "sent",
            });
            dc.send(JSON.stringify({ kind: "ack", clientId: message.clientId } satisfies DataChannelMessage));
          } else if (message.kind === "ack") {
            const timer = ackTimersRef.current.get(message.clientId);
            if (timer) {
              clearTimeout(timer);
              ackTimersRef.current.delete(message.clientId);
            }
            updateStatus(peerUsername, message.clientId, "sent");
          } else if (message.kind === "read") {
            updateStatus(peerUsername, message.clientId, "read");
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
  }, [selfUsername, peerUsername, addMessage, updateStatus]);

  function sendMessage(text: string) {
    const clientId = crypto.randomUUID();
    addMessage(peerUsername, { clientId, text, fromSelf: true, status: "sending" });

    const dc = dcRef.current;
    if (dc && dc.readyState === "open") {
      updateStatus(peerUsername, clientId, "in-transit");
      dc.send(JSON.stringify({ kind: "text", clientId, text } satisfies DataChannelMessage));
      armAckTimeout(clientId, () => dispatchTextViaServer(clientId, text));
    } else {
      updateStatus(peerUsername, clientId, "in-transit");
      dispatchTextViaServer(clientId, text);
    }
  }

  async function sendFile(file: File) {
    const clientId = crypto.randomUUID();
    const url = URL.createObjectURL(file);
    addMessage(peerUsername, {
      clientId,
      file: { name: file.name, type: file.type, url },
      fromSelf: true,
      status: "sending",
    });

    const dc = dcRef.current;
    if (dc && dc.readyState === "open") {
      updateStatus(peerUsername, clientId, "in-transit");
      dc.send(JSON.stringify({ kind: "file-start", clientId, name: file.name, type: file.type } satisfies DataChannelMessage));

      const buffer = await file.arrayBuffer();
      for (let offset = 0; offset < buffer.byteLength; offset += CHUNK_SIZE) {
        dc.send(buffer.slice(offset, offset + CHUNK_SIZE));
      }

      dc.send(JSON.stringify({ kind: "file-end", clientId } satisfies DataChannelMessage));
      armAckTimeout(clientId, () => dispatchFileViaServer(clientId, file));
    } else {
      updateStatus(peerUsername, clientId, "in-transit");
      dispatchFileViaServer(clientId, file);
    }
  }

  return { connected, messages, sendMessage, sendFile };
}
