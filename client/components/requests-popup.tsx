"use client";

import { useEffect, useState } from "react";
import { fetchContactRequests, type ContactRequest, type User } from "@/lib/api";
import { Popup } from "./popup";

export function RequestsPopup({ open, onClose, user }: { open: boolean; onClose: () => void; user: User }) {
  const [requests, setRequests] = useState<ContactRequest[]>([]);

  useEffect(() => {
    if (!open) return;
    fetchContactRequests(user.username).then(setRequests);
  }, [open, user]);

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
              {/* Accept action wired in a later phase — see plans/contacts Phase 6 */}
              <button
                disabled
                className="rounded-full bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
              >
                Accept
              </button>
            </li>
          ))}
        </ul>
      )}
    </Popup>
  );
}
