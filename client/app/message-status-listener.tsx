"use client";

import { useEffect } from "react";
import { ackMessage, deleteMessage } from "@/lib/api";
import { incrementUnread } from "@/lib/chats";
import { useMessagesStore } from "@/lib/messages-store";
import { useSessionStore } from "@/lib/session-store";
import { useSignalingStore } from "@/lib/signaling-store";

// Root-level (not per-chat-page) subscriber for message-status pushes, so a
// new-message/message-acked notice updates the right conversation regardless
// of which chat page (if any) is currently mounted — same reasoning as
// SignalingConnection living at the root instead of inside a chat page.
export function MessageStatusListener() {
  const user = useSessionStore((s) => s.user);
  const addMessage = useMessagesStore((s) => s.addMessage);
  const updateStatus = useMessagesStore((s) => s.updateStatus);

  useEffect(() => {
    if (!user) return;
    return useSignalingStore.getState().subscribe((message) => {
      if (message.type !== "new-message" && message.type !== "message-acked") return;

      if (message.type === "new-message") {
        const row = message.message;
        // Awaited before addMessage: addMessage's store update synchronously
        // triggers chat/page.tsx's conversations refresh, which reads
        // unreadCount straight from the DB — if that refresh fires before
        // this write lands, it reads the stale (pre-increment) count.
        incrementUnread(user.id, row.fromUserId).then(() => {
          addMessage(message.fromUsername, {
            messageId: row.clientId,
            text: row.text ?? undefined,
            files: row.fileUrl ? [{ name: row.fileName!, type: row.fileType!, url: row.fileUrl }] : [],
            fromSelf: false,
            status: "sent",
            createdAt: row.createdAt,
          });
        });
        ackMessage(row.id);
      } else {
        updateStatus(message.peerUsername, message.clientId, "sent");
        deleteMessage(message.id);
      }
    });
  }, [user, addMessage, updateStatus]);

  return null;
}
