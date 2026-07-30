"use client";

import { useEffect } from "react";
import { ackMessage, deleteMessage } from "@/lib/api";
import { useMessagesStore } from "@/lib/messages-store";
import { useSignalingStore } from "@/lib/signaling-store";

// Root-level (not per-chat-page) subscriber for message-status pushes, so a
// new-message/message-acked notice updates the right conversation regardless
// of which chat page (if any) is currently mounted — same reasoning as
// SignalingConnection living at the root instead of inside a chat page.
export function MessageStatusListener() {
  const addMessage = useMessagesStore((s) => s.addMessage);
  const updateStatus = useMessagesStore((s) => s.updateStatus);

  useEffect(() => {
    return useSignalingStore.getState().subscribe((message) => {
      if (message.type !== "new-message" && message.type !== "message-acked") return;

      if (message.type === "new-message") {
        const row = message.message;
        addMessage(message.fromUsername, {
          clientId: row.clientId,
          text: row.text ?? undefined,
          file: row.fileUrl ? { name: row.fileName!, type: row.fileType!, url: row.fileUrl } : undefined,
          fromSelf: false,
          status: "sent",
        });
        ackMessage(row.id);
      } else {
        updateStatus(message.peerUsername, message.clientId, "sent");
        deleteMessage(message.id);
      }
    });
  }, [addMessage, updateStatus]);

  return null;
}
