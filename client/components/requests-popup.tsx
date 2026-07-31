"use client";

import { useEffect, useRef, useState } from "react";
import { acceptContactRequest, fetchContactRequests, type ContactRequestNotification, type User } from "@/lib/api";
import { addContact, syncAcceptedContact } from "@/lib/contacts";
import { Popup } from "./popup";

export function RequestsPopup({
  open,
  onClose,
  user,
  highlightId,
}: {
  open: boolean;
  onClose: () => void;
  user: User;
  highlightId?: string | null;
}) {
  const [notifications, setNotifications] = useState<ContactRequestNotification[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const highlightRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!open) return;
    fetchContactRequests(user.username).then((rows) => {
      setNotifications(rows);
      // An outgoing request may have been accepted while this client wasn't
      // listening for the live push (tab closed, notification dismissed) —
      // this popup is the durable fallback path, push is just the fast one.
      for (const n of rows) {
        if (n.data.direction === "outgoing" && n.status === "accepted") {
          syncAcceptedContact(
            user.username,
            { id: n.data.otherUserId, username: n.data.otherUsername },
            n.data.scannedFingerprint,
          );
        }
      }
    });
  }, [open, user]);

  useEffect(() => {
    if (!highlightId || notifications.length === 0) return;
    highlightRef.current?.scrollIntoView({ block: "center" });
  }, [highlightId, notifications]);

  async function handleAccept(notification: ContactRequestNotification) {
    if (notification.data.direction !== "incoming") return;
    setAcceptingId(notification.id);
    try {
      const contact = await acceptContactRequest(notification.id, user.username);
      await addContact({
        ownerUsername: user.username,
        id: contact.id,
        username: contact.username,
        mlKemPublicKey: contact.mlKemPublicKey,
        acceptedAt: new Date().toISOString(),
      });
      setNotifications((prev) => prev.map((n) => (n.id === notification.id ? { ...n, status: "accepted" } : n)));
    } catch (err) {
      console.error("failed to accept contact request:", err);
    } finally {
      setAcceptingId(null);
    }
  }

  function description(n: ContactRequestNotification): string {
    if (n.data.direction === "incoming") {
      return n.status === "accepted"
        ? `You added ${n.data.otherUsername} as a contact.`
        : `${n.data.otherUsername} wants to add you as a contact.`;
    }
    return n.status === "accepted"
      ? `${n.data.otherUsername} accepted your contact request.`
      : `Contact request sent to ${n.data.otherUsername}.`;
  }

  return (
    <Popup open={open} onClose={onClose} title="Notifications" buttons={[]}>
      {notifications.length === 0 ? (
        <p className="text-sm text-zinc-500">No notifications.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notifications.map((n) => (
            <li
              key={n.id}
              ref={n.id === highlightId ? highlightRef : undefined}
              className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 transition-colors ${
                n.id === highlightId
                  ? "border-orange-500 bg-orange-500/10"
                  : "border-black/10 dark:border-white/10"
              }`}
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-black dark:text-zinc-50">{n.data.otherUsername}</span>
                <span className="text-sm text-zinc-500">{description(n)}</span>
              </div>
              {n.data.direction === "incoming" && n.status === "pending" ? (
                <button
                  onClick={() => handleAccept(n)}
                  disabled={acceptingId === n.id}
                  className="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  style={{ backgroundColor: "#16a34a" }}
                >
                  {acceptingId === n.id ? "Accepting…" : "Accept"}
                </button>
              ) : (
                <span
                  className={`shrink-0 text-sm ${
                    n.status === "accepted" ? "text-green-600 dark:text-green-500" : "text-zinc-500"
                  }`}
                >
                  {n.status === "accepted" ? "Accepted" : "Pending"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Popup>
  );
}
