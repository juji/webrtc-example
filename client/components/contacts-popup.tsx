"use client";

import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { User } from "@/lib/api";
import { listContacts, type Contact } from "@/lib/contacts";
import { Popup } from "./popup";

export function ContactsPopup({
  open,
  onClose,
  user,
  onSelectContact,
}: {
  open: boolean;
  onClose: () => void;
  user: User;
  onSelectContact: (contact: Contact) => void;
}) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setQuery("");
    listContacts(user.id).then(setContacts);
  }, [open, user]);

  const filtered = contacts.filter((c) => c.username.toLowerCase().includes(query.toLowerCase()));

  return (
    <Popup open={open} onClose={onClose} title="Contacts" buttons={[]}>
      <div className="flex flex-col gap-4">
        <div className="sticky -top-6 z-10 -mx-6 -mt-6 bg-background px-6 pt-6 pb-4">
          <div className="flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 dark:border-white/10">
            <Search className="h-4 w-4 shrink-0 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search contacts"
              className="w-full bg-transparent text-sm text-black outline-none placeholder:text-zinc-500 dark:text-zinc-50"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-zinc-500">
            {contacts.length === 0 ? "No contacts yet." : "No contacts match your search."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => {
                    onSelectContact(c);
                    onClose();
                  }}
                  className="flex w-full items-center gap-3 rounded-lg border border-black/10 px-4 py-3 text-left hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
                >
                  <span className="font-medium text-black dark:text-zinc-50">{c.username}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Popup>
  );
}
