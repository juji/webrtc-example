"use client";

import { useEffect, useState } from "react";
import { acceptContactRequest, fetchContactRequests, type ContactRequest, type User } from "@/lib/api";
import { addContact } from "@/lib/contacts";
import { Popup } from "./popup";

export function RequestsPopup({ open, onClose, user }: { open: boolean; onClose: () => void; user: User }) {
  const [requests, setRequests] = useState<ContactRequest[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetchContactRequests(user.username).then(setRequests);
  }, [open, user]);

  async function handleAccept(request: ContactRequest) {
    setAcceptingId(request.id);
    try {
      const contact = await acceptContactRequest(request.id, user.username);
      await addContact({
        ownerUsername: user.username,
        id: contact.id,
        username: contact.username,
        mlKemPublicKey: contact.mlKemPublicKey,
        acceptedAt: new Date().toISOString(),
      });
      setRequests((prev) => prev.filter((r) => r.id !== request.id));
    } catch (err) {
      console.error("failed to accept contact request:", err);
    } finally {
      setAcceptingId(null);
    }
  }

  return (
    <Popup open={open} onClose={onClose} title="Contact requests" buttons={[]}>
      {requests.length === 0 ? (
        <p className="text-sm text-zinc-500">No pending requests.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {requests.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between rounded-lg border border-black/10 px-4 py-3 dark:border-white/10"
            >
              <span className="font-medium text-black dark:text-zinc-50">{r.fromUsername}</span>
              <button
                onClick={() => handleAccept(r)}
                disabled={acceptingId === r.id}
                className="rounded-full px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: "#16a34a" }}
              >
                {acceptingId === r.id ? "Accepting…" : "Accept"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Popup>
  );
}
