import { useEffect, useRef, useState } from "react";
import { uuidv7 } from "uuidv7";
import { ackMessage, fetchFailoverMessages, readMessage, sendFailoverFile, sendFailoverMessage, SERVER_URL } from "./api";
import { clearUnread, setLastMessage } from "./chats";
import { addMessage as persistMessage, getFileBlob, listMessages, storeFileBlob } from "./convos";
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

async function fetchIceServers(): Promise<{ iceServers: RTCIceServer[]; renew: number }> {
  const res = await fetch(`${SERVER_URL}/turn/credentials`);
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`failed to fetch TURN credentials: ${error}`);
  }
  const { creds, renew } = await res.json();
  return { iceServers: creds.iceServers, renew };
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
  // source of truth, this is a write-through, not a replacement for it. Also
  // updates the conversation's lastMessage, so the chat/page.tsx sidebar
  // preview reflects the real latest message instead of staying blank.
  function persist(message: ChatMessage) {
    persistMessage({
      ownerId: selfId,
      threadId: peerId,
      messageId: message.messageId,
      serverId: message.serverId,
      sender: message.fromSelf ? { id: selfId, username: selfUsername } : { id: peerId, username: peerUsername },
      text: message.text,
      file: message.file,
      status: message.status,
      createdAt: message.createdAt,
      sentAt: message.status === "sent" || message.status === "read" ? new Date().toISOString() : null,
      deliveredAt: message.status === "read" ? new Date().toISOString() : null,
    });
    setLastMessage(selfId, peerId, {
      sender: message.fromSelf ? selfUsername : peerUsername,
      message: message.text ?? message.file?.name ?? "",
      status: message.status,
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
  // id isn't tracked client-side — message-acked carries it directly, and the
  // server deletes the row once the recipient reads it, so no client-side
  // cleanup is needed even after closing and reopening the app.
  function dispatchTextViaServer(messageId: string, text: string) {
    sendFailoverMessage({ clientId: messageId, toUsername: peerUsername, text }).then(() =>
      updateStatusAndPersist(messageId, "sent"),
    );
  }

  function dispatchFileViaServer(messageId: string, file: File) {
    sendFailoverFile({ clientId: messageId, toUsername: peerUsername, file }).then(() =>
      updateStatusAndPersist(messageId, "sent"),
    );
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
  // Only seeds messages this peer thread doesn't already have in memory. React
  // StrictMode (dev) mounts/cleans-up/mounts again in the same tick, so without
  // the `cancelled` guard both invocations would see an empty existingIds set
  // (each captured before either's async listMessages call resolves) and both
  // would insert every row, duplicating the whole history.
  useEffect(() => {
    let cancelled = false;
    listMessages(selfId, peerId).then(async (rows) => {
      if (cancelled) return;
      for (const row of rows) {
        // Re-checked fresh each iteration (not a snapshot taken once before the
        // loop): the loop now awaits getFileBlob per-row, so a concurrent second
        // invocation of this same effect (React StrictMode's double-mount) can
        // interleave with this one — a static pre-loop snapshot would let both
        // decide "not present yet" for the same row and both call addMessage.
        if (useMessagesStore.getState().byPeer[peerUsername]?.some((m) => m.messageId === row.messageId)) continue;
        // blob: URLs die with the page that minted them — a stored file was
        // a P2P transfer, whose bytes only otherwise live in that dead blob.
        // Re-fetch from OPFS and mint a fresh URL, or drop the file if there's
        // no stored copy (relay uploads never store one; nothing to rehydrate).
        let file = row.file;
        if (file?.url.startsWith("blob:")) {
          const blob = await getFileBlob(row.messageId);
          file = blob ? { ...file, url: URL.createObjectURL(blob) } : undefined;
        }
        if (cancelled) return;
        if (useMessagesStore.getState().byPeer[peerUsername]?.some((m) => m.messageId === row.messageId)) continue;
        addMessage(peerUsername, {
          messageId: row.messageId,
          text: row.text,
          file,
          fromSelf: row.sender.id === selfId,
          status: row.status,
          createdAt: row.createdAt,
        });
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfId, peerId, peerUsername]);

  // One-shot catch-up fetch on mount: anything the peer sent while this device
  // was unreachable. Not a poll — runs once per chat-page visit. `cancelled`
  // guards against React StrictMode's dev-mode double-mount duplicating every
  // row in memory (same reasoning as the persisted-history load above).
  useEffect(() => {
    let cancelled = false;
    fetchFailoverMessages(peerUsername).then((rows) => {
      if (cancelled) return;
      for (const row of rows) {
        addAndPersist({
          messageId: row.clientId,
          serverId: row.id,
          text: row.text ?? undefined,
          file: row.file ? JSON.parse(row.file) : undefined,
          fromSelf: false,
          status: "sent",
          createdAt: row.createdAt,
        });
        ackMessage(row.id);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerUsername, selfUsername]);

  // Viewing a thread marks the peer's delivered messages read — local status
  // flip, plus a receipt back to the sender: an echo over the data channel if
  // still connected (P2P), or POST /:id/read for messages that came in via
  // the server fallback (no data channel to echo over).
  useEffect(() => {
    const state = useMessagesStore.getState();
    const unread = (state.byPeer[peerUsername] ?? EMPTY_MESSAGES).filter((m) => !m.fromSelf && m.status === "sent");
    if (unread.length === 0) return;
    // Cleared before the per-message updateStatusAndPersist calls below: those
    // synchronously trigger chat/page.tsx's conversations refresh (via the
    // messages-store subscription), which reads unreadCount straight from the
    // DB — if that refresh fires before this write lands, it reads the stale
    // (pre-clear) count.
    clearUnread(selfId, peerId).then(() => {
      for (const m of unread) {
        updateStatusAndPersist(m.messageId, "read");
        if (dcRef.current?.readyState === "open") {
          dcRef.current.send(JSON.stringify({ kind: "read", messageId: m.messageId } satisfies DataChannelMessage));
        } else if (m.serverId) {
          readMessage(m.serverId);
        }
      }
    });
  });

  useEffect(() => {
    // React StrictMode (dev) mounts, cleans up, and mounts again in the same tick. Opening the
    // RTCPeerConnection only after the ICE servers fetch resolves lets the aborted first run's
    // cleanup flip `cancelled` before any real connection is made.
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let renewTimer: ReturnType<typeof setTimeout> | undefined;

    fetchIceServers().then(({ iceServers, renew }) => {
      if (cancelled) return;

      const iceTransportPolicy = (process.env.NEXT_PUBLIC_ICE_TRANSPORT_POLICY ?? "all") as RTCIceTransportPolicy;
      const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy });
      pcRef.current = pc;

      // Some providers (coturn, cfSpeed) issue short-lived credentials — renew
      // tells us when they expire so future ICE restarts/reconnects don't try
      // stale ones. setConfiguration updates the connection in place; it
      // doesn't affect candidates already gathered on the current connection.
      function scheduleRenew(renewAt: number) {
        if (!renewAt) return;
        renewTimer = setTimeout(async () => {
          const next = await fetchIceServers();
          if (cancelled) return;
          pc.setConfiguration({ iceServers: next.iceServers, iceTransportPolicy });
          scheduleRenew(next.renew);
        }, Math.max(0, renewAt - Date.now()));
      }
      scheduleRenew(renew);

      function send(message: SignalMessage) {
        useSignalingStore.getState().send({ ...message, to: peerId });
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
            storeFileBlob(message.messageId, blob);
            addAndPersist({
              messageId: message.messageId,
              file: { name: transfer.name, type: transfer.type, url },
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
          send({ type: "ice-candidate", candidate: event.candidate.toJSON(), to: peerId });
        }
      };

      if (isInitiator(selfId, peerId)) {
        setupDataChannel(pc.createDataChannel("chat"));
      } else {
        pc.ondatachannel = (event) => setupDataChannel(event.channel);
      }

      // Sends a fresh offer on an already-`stable` pc (iceRestart forces new ICE
      // credentials so it renegotiates a real transport instead of reusing dead
      // candidates). Used both for the initial handshake and to recover when the
      // peer reconnects without this side's own pc ever tearing down (below).
      // `pc.signalingState` doesn't leave "stable" until setLocalDescription
      // actually resolves, so a `peer-online` broadcast arriving while the
      // initial offer's createOffer()/setLocalDescription() is still in flight
      // sees a pc that looks stable and idle — offering again here interleaves
      // two createDataChannel/createOffer sequences on the same pc, producing
      // mismatched m-line order. `offering` guards the whole async span, not
      // just the signalingState check.
      let offering = false;
      function offer(iceRestart = false) {
        if (offering) return;
        offering = true;
        pc.createOffer({ iceRestart }).then(async (sdp) => {
          await pc.setLocalDescription(sdp);
          send({ type: "offer", sdp, to: peerId });
        }).finally(() => {
          offering = false;
        });
      }

      unsubscribe = useSignalingStore.getState().subscribe(async (message) => {
        if (message.type === "peer-online") {
          // Only the initiator re-offers — the answerer just waits for it, same
          // as the initial handshake. A pc that's still "stable" here means it
          // never tore down (dc.onclose didn't fire) but its peer just came back
          // with a brand-new pc that has nothing to answer unless we re-offer.
          if (message.from === peerId && isInitiator(selfId, peerId) && pc.signalingState === "stable" && !offering) {
            // Renegotiating the existing pc does not revive the old data channel —
            // once a channel's onclose has fired its readyState is permanently
            // "closed", and the peer's pc.ondatachannel only ever fires once per
            // channel. A fresh channel is required for the reconnect to actually
            // produce a new dc.onopen on either side.
            setupDataChannel(pc.createDataChannel("chat"));
            offer(true);
          }
          return;
        }
        if (message.type !== "offer" && message.type !== "answer" && message.type !== "ice-candidate") return;
        if (message.from !== peerId) return;

        if (message.type === "offer") {
          // Stale/duplicate offer replayed from signaling-store's recent-message
          // buffer, or a second offer arriving after this connection already
          // negotiated — applying it now would throw (wrong signalingState).
          if (pc.signalingState !== "stable") return;
          await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send({ type: "answer", sdp: answer, to: peerId });
        } else if (message.type === "answer") {
          // No matching offer in flight for this connection — same stale-replay
          // case as above, just for the other half of the handshake.
          if (pc.signalingState !== "have-local-offer") return;
          await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
        } else if (message.type === "ice-candidate") {
          await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
        }
      });

      if (isInitiator(selfId, peerId)) {
        offer();
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(renewTimer);
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
    storeFileBlob(messageId, file);
    addAndPersist({
      messageId,
      file: { name: file.name, type: file.type, url },
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
