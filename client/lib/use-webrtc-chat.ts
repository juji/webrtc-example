import { useEffect, useRef, useState } from "react";
import { SERVER_URL } from "./api";
import { useSignalingStore, type SignalMessage } from "./signaling-store";

// Every text frame on the data channel is one of these. Binary frames are always
// raw file chunks belonging to the most recently started transfer.
type DataChannelMessage =
  | { kind: "text"; text: string }
  | { kind: "file-start"; id: string; name: string; type: string }
  | { kind: "file-end"; id: string };

export type ChatMessage = {
  text?: string;
  file?: { name: string; type: string; url: string };
  fromSelf: boolean;
};

// RTCDataChannel messages are unreliable above a few hundred KB across browsers,
// so files are sliced into small binary chunks and reassembled on the other end.
const CHUNK_SIZE = 16 * 1024;

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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const incomingFileRef = useRef<{ id: string; name: string; type: string; chunks: ArrayBuffer[] } | null>(
    null,
  );

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
            setMessages((prev) => [...prev, { text: message.text, fromSelf: false }]);
          } else if (message.kind === "file-start") {
            incomingFileRef.current = { id: message.id, name: message.name, type: message.type, chunks: [] };
          } else if (message.kind === "file-end") {
            const transfer = incomingFileRef.current;
            incomingFileRef.current = null;
            if (!transfer || transfer.id !== message.id) return;
            const blob = new Blob(transfer.chunks, { type: transfer.type });
            const url = URL.createObjectURL(blob);
            setMessages((prev) => [
              ...prev,
              { file: { name: transfer.name, type: transfer.type, url }, fromSelf: false },
            ]);
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
  }, [selfUsername, peerUsername]);

  function sendMessage(text: string) {
    const dc = dcRef.current;
    if (!dc) return;
    dc.send(JSON.stringify({ kind: "text", text } satisfies DataChannelMessage));
    setMessages((prev) => [...prev, { text, fromSelf: true }]);
  }

  async function sendFile(file: File) {
    const dc = dcRef.current;
    if (!dc) return;

    const id = crypto.randomUUID();
    dc.send(JSON.stringify({ kind: "file-start", id, name: file.name, type: file.type } satisfies DataChannelMessage));

    const buffer = await file.arrayBuffer();
    for (let offset = 0; offset < buffer.byteLength; offset += CHUNK_SIZE) {
      dc.send(buffer.slice(offset, offset + CHUNK_SIZE));
    }

    dc.send(JSON.stringify({ kind: "file-end", id } satisfies DataChannelMessage));

    const url = URL.createObjectURL(file);
    setMessages((prev) => [...prev, { file: { name: file.name, type: file.type, url }, fromSelf: true }]);
  }

  return { connected, messages, sendMessage, sendFile };
}
