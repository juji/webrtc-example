"use client";

import { useEffect, useState } from "react";
import { acceptContactRequest, fetchContactRequests, type ContactRequestNotification, type User } from "@/lib/api";
import { addContact, syncAcceptedContact } from "@/lib/contacts";
import { Popup } from "./popup";

export function RequestsPopup({ open, onClose, user }: { open: boolean; onClose: () => void; user: User }) {
  const [notifications, setNotifications] = useState<ContactRequestNotification[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

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

  const received = notifications.filter((n) => n.data.direction === "incoming");
  const sent = notifications.filter((n) => n.data.direction === "outgoing");

  return (
    <Popup open={open} onClose={onClose} title="Notifications" buttons={[]}>
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Received</h3>
          {received.length === 0 ? (
            <p className="text-sm text-zinc-500">No contact requests.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {received.map((n) => (
                <li
                  key={n.id}
                  className="flex items-center justify-between rounded-lg border border-black/10 px-4 py-3 dark:border-white/10"
                >
                  <span className="font-medium text-black dark:text-zinc-50">{n.data.otherUsername}</span>
                  {n.status === "accepted" ? (
                    <span className="text-sm text-green-600 dark:text-green-500">Accepted</span>
                  ) : (
                    <button
                      onClick={() => handleAccept(n)}
                      disabled={acceptingId === n.id}
                      className="rounded-full px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                      style={{ backgroundColor: "#16a34a" }}
                    >
                      {acceptingId === n.id ? "Accepting…" : "Accept"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Sent</h3>
          {sent.length === 0 ? (
            <p className="text-sm text-zinc-500">No requests sent.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {sent.map((n) => (
                <li
                  key={n.id}
                  className="flex items-center justify-between rounded-lg border border-black/10 px-4 py-3 dark:border-white/10"
                >
                  <span className="font-medium text-black dark:text-zinc-50">{n.data.otherUsername}</span>
                  <span className="text-sm text-zinc-500">{n.status === "accepted" ? "Accepted" : "Pending"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Popup>
  );
}
